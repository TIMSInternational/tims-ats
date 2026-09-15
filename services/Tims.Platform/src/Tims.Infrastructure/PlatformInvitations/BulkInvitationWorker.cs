using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Tims.Application.PlatformInvitations;
using Tims.Infrastructure.PlatformOrganizations;

namespace Tims.Infrastructure.PlatformInvitations;

public sealed class BulkInvitationWorker(IServiceScopeFactory scopes) : IBulkInvitationWorker
{
    public async Task<bool> OrganizationAvailableAsync(Guid org, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PlatformOrganizationsCreateDbContext>();
        db.Database.SetCommandTimeout(2);
        await using var tenant = await TenantScope.BeginAsync(db, org, ct);
        var available = await db.Organizations.AnyAsync(o => o.Id == org && o.IsActive && o.DeletedAt == null, ct);
        await tenant.CommitAsync(ct); return available;
    }

    public async Task<UserInvitationCreateResult> ExecuteAsync(UserInvitationInput input, Guid actor, Uri origin, CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<PlatformOrganizationsCreateDbContext>().Database.SetCommandTimeout(2);
        return await scope.ServiceProvider.GetRequiredService<UserInvitationCreateUseCase>().ExecuteUniqueAsync(input, actor, origin, ct);
    }
}
