namespace Tims.Application.PlatformInvitations;

public sealed record BulkInvitee(string Email, string? RoleSlug = null);
public sealed record BulkInvitationInput(Guid OrganizationId, IReadOnlyList<BulkInvitee> Users);
public sealed record BulkInvitationResult(int Index, string Email, string Status, string? Reason = null);
public sealed record BulkInvitationSummary(int Total, int Sent, int Duplicates, int Errors);
public sealed record BulkInvitationResponse(IReadOnlyList<BulkInvitationResult> Results, BulkInvitationSummary Summary);

/// <summary>Each call owns a separate scope/context; never share EF contexts across batch workers.</summary>
public interface IBulkInvitationWorker
{
    Task<bool> OrganizationAvailableAsync(Guid org, CancellationToken ct);
    Task<UserInvitationCreateResult> ExecuteAsync(UserInvitationInput input, Guid actor, Uri origin, CancellationToken ct);
}

public sealed class BulkInvitationUseCase(IBulkInvitationWorker worker, TimeProvider clock)
{
    private static readonly TimeSpan Budget = TimeSpan.FromSeconds(18);
    private static readonly TimeSpan ItemBudget = TimeSpan.FromSeconds(6);
    public static bool IsValid(BulkInvitationInput input) => input.OrganizationId != Guid.Empty && input.Users.Count is >= 1 and <= 200 &&
        input.Users.All(u => UserInvitationCreateUseCase.IsValid(new(u.Email, input.OrganizationId, u.RoleSlug)));

    public async Task<BulkInvitationResponse?> ExecuteAsync(BulkInvitationInput input, Guid actor, Uri origin, CancellationToken ct)
    {
        if (!IsValid(input)) throw new ArgumentException("Invalid bulk invitation input");
        var start = clock.GetTimestamp();
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(ct);
        budget.CancelAfter(Budget);
        if (!await worker.OrganizationAvailableAsync(input.OrganizationId, budget.Token)) return null;
        var results = new BulkInvitationResult[input.Users.Count];
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var indices = new Queue<int>();
        for (var i = 0; i < input.Users.Count; i++)
        {
            if (seen.Add(input.Users[i].Email)) indices.Enqueue(i);
            else results[i] = new(i, input.Users[i].Email, "duplicate", "duplicate_row");
        }
        var sync = new object();
        async Task RunWorker()
        {
            while (true)
            {
                int index;
                lock (sync) { if (!indices.TryDequeue(out index)) return; }
                var user = input.Users[index];
                if (budget.IsCancellationRequested || Budget - clock.GetElapsedTime(start) < ItemBudget)
                { results[index] = new(index, user.Email, "error", "not_attempted"); continue; }
                using var item = CancellationTokenSource.CreateLinkedTokenSource(budget.Token);
                item.CancelAfter(ItemBudget);
                try
                {
                    var result = await worker.ExecuteAsync(new(user.Email, input.OrganizationId, user.RoleSlug), actor, origin, item.Token);
                    results[index] = result.Outcome switch
                    {
                        UserInvitationCreateOutcome.Duplicate => new(index, user.Email, "duplicate", "already_invited"),
                        UserInvitationCreateOutcome.OrganizationUnavailable => new(index, user.Email, "error", "organization_unavailable"),
                        UserInvitationCreateOutcome.RoleUnavailable => new(index, user.Email, "error", "role_unavailable"),
                        _ => result.Response?.Delivery switch
                        {
                            "accepted" => new(index, user.Email, "sent"),
                            "unconfirmed" => new(index, user.Email, "error", "delivery_unconfirmed"),
                            "changed" => new(index, user.Email, "error", "state_changed"),
                            "state_unconfirmed" => new(index, user.Email, "error", "state_unconfirmed"),
                            _ => new(index, user.Email, "error", "operation_unconfirmed"),
                        },
                    };
                }
                catch (Exception) { results[index] = new(index, user.Email, "error", "operation_unconfirmed"); }
            }
        }
        await Task.WhenAll(Enumerable.Range(0, Math.Min(4, indices.Count)).Select(_ => RunWorker()));
        return new(results, new(input.Users.Count, results.Count(r => r.Status == "sent"), results.Count(r => r.Status == "duplicate"), results.Count(r => r.Status == "error")));
    }
}
