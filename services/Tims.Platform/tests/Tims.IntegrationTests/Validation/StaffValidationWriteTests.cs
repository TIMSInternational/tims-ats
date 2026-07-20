using System.Text.Json.Nodes;
using Tims.Domain.Validation;
using Tims.Infrastructure.Validation;

namespace Tims.IntegrationTests.Validation;

/// <summary>
/// Phase-5 staff-validation-write direct-repository tests (real Postgres + real RLS + the single-completer
/// CHECK): each op runs UNDER TenantScope (SET LOCAL ROLE app_tenant + org GUC). Proves the partial update
/// writes only the intended columns, sets the staff completer (satisfying the XOR), and drives completedAt
/// from the completing status — all through the real DB.
/// </summary>
[Collection("StaffValidation")]
public sealed class StaffValidationWriteTests(StaffValidationFixture fixture)
{
    private static readonly DateTimeOffset Now = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);
    private readonly StaffValidationFixture _fixture = fixture;

    private StaffValidationRepository NewRepo() => new(_fixture.NewWriteContext());

    private static StaffValidationUpdateCommand Command(string json) =>
        StaffValidationUpdateCommand.Create(JsonNode.Parse(json));

    private string Org => StaffValidationFixture.OrgA.ToString();

    [Fact]
    public async Task FindOfferId_returns_offer_for_known_validation_and_null_for_unknown()
    {
        Assert.Equal(
            StaffValidationFixture.OfferInScope,
            await NewRepo().FindOfferIdAsync(Org, StaffValidationFixture.PvReadOnlyO1.ToString(), CancellationToken.None));

        Assert.Null(await NewRepo().FindOfferIdAsync(Org, Guid.NewGuid().ToString(), CancellationToken.None));
    }

    [Fact]
    public async Task Update_completing_sets_staff_completer_result_notes_and_completedAt()
    {
        var row = await NewRepo().UpdateAsync(
            Org,
            StaffValidationFixture.PvDirectCompleting.ToString(),
            Command("""{ "status": "passed", "result": { "x": 1 }, "notes": "done" }"""),
            StaffValidationFixture.OrgAdminId,
            Now,
            CancellationToken.None);

        Assert.NotNull(row);
        Assert.Equal("passed", row!.Status);
        // Staff completer set, api-key completer null → the single_completer_chk XOR is satisfied (no 23514).
        Assert.Equal(StaffValidationFixture.OrgAdminId.ToString(), row.CompletedById);
        Assert.Null(row.CompletedByApiKeyId);
        Assert.NotNull(row.CompletedAt); // completing status → now
        Assert.Equal("done", row.Notes);
        Assert.Equal(1, row.Result!["x"]!.GetValue<int>());
    }

    [Fact]
    public async Task Update_pending_leaves_completedAt_null_but_still_records_the_actor()
    {
        var row = await NewRepo().UpdateAsync(
            Org,
            StaffValidationFixture.PvDirectPending.ToString(),
            Command("""{ "status": "pending" }"""),
            StaffValidationFixture.OrgAdminId,
            Now,
            CancellationToken.None);

        Assert.NotNull(row);
        Assert.Equal("pending", row!.Status);
        Assert.Null(row.CompletedAt); // pending → completedAt null
        Assert.Equal(StaffValidationFixture.OrgAdminId.ToString(), row.CompletedById); // actor still recorded
        Assert.Null(row.CompletedByApiKeyId);
    }

    [Fact]
    public async Task Update_partial_leaves_unprovided_result_untouched()
    {
        // PV6 is seeded result {"pre":1}; the update omits result → the column must be UNCHANGED (Prisma
        // undefined-skip parity), while status/completer are written.
        var row = await NewRepo().UpdateAsync(
            Org,
            StaffValidationFixture.PvDirectPartial.ToString(),
            Command("""{ "status": "failed" }"""),
            StaffValidationFixture.OrgAdminId,
            Now,
            CancellationToken.None);

        Assert.NotNull(row);
        Assert.Equal("failed", row!.Status);
        Assert.NotNull(row.Result);
        Assert.Equal(1, row.Result!["pre"]!.GetValue<int>()); // untouched
    }

    [Fact]
    public async Task Update_unknown_validation_returns_null()
    {
        var row = await NewRepo().UpdateAsync(
            Org,
            Guid.NewGuid().ToString(),
            Command("""{ "status": "passed" }"""),
            StaffValidationFixture.OrgAdminId,
            Now,
            CancellationToken.None);

        Assert.Null(row);
    }
}
