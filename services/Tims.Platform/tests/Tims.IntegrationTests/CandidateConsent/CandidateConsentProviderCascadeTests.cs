using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Application.CandidateConsent;
using Tims.Infrastructure.CandidateConsent;

namespace Tims.IntegrationTests.CandidateConsent;

/// <summary>
/// Owner default D15: a #312 withdrawal stops the candidate's assessment-provider attempts IN ITS OWN TRANSACTION (the
/// cascade runs under the per-candidate lock the withdrawal holds). The provider table here is a stand-in with only
/// the columns the staging statement touches, under the same RLS mechanism as the rest of this fixture.
/// </summary>
[Collection("CandidateConsent")]
public sealed class CandidateConsentProviderCascadeTests(CandidateConsentFixture fixture)
{
    private const string StandIn =
        """
        CREATE TABLE IF NOT EXISTS assessment_provider_attempts (
            id uuid PRIMARY KEY, organization_id uuid NOT NULL, candidate_id uuid NOT NULL, state text NOT NULL,
            provider_assignment_id uuid NULL, last_error_code text NULL, withdrawal_state text NULL,
            updated_at timestamptz NOT NULL DEFAULT now());
        ALTER TABLE assessment_provider_attempts ENABLE ROW LEVEL SECURITY;
        ALTER TABLE assessment_provider_attempts FORCE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS tenant_isolation ON assessment_provider_attempts;
        CREATE POLICY tenant_isolation ON assessment_provider_attempts
            USING (organization_id = NULLIF(current_setting('app.current_org_id', true), '')::uuid);
        GRANT SELECT, INSERT, UPDATE ON assessment_provider_attempts TO app_tenant;
        """;

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    private CandidateConsentDbContext NewContext() => new(
        new DbContextOptionsBuilder<CandidateConsentDbContext>().UseNpgsql(fixture.ConnectionString).Options);

    [Fact]
    public async Task A_staff_withdrawal_stages_the_candidates_provider_attempts_in_the_same_commit()
    {
        await ExecuteAsync(StandIn);
        var org = CandidateConsentFixture.OrgA;
        var candidate = Guid.NewGuid();
        var other = Guid.NewGuid();
        var (open, finished, unrelated) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await ExecuteAsync(
            $"""
             INSERT INTO candidates (id, organization_id, email, first_name, last_name)
             VALUES ('{candidate}', '{org}', '{candidate}@example.com', 'Wil', 'Drawn'),
                    ('{other}', '{org}', '{other}@example.com', 'Sta', 'Ys');
             INSERT INTO data_consents (id, organization_id, subject_user_id, consent_type, text_version, updated_at)
             VALUES (gen_random_uuid(), '{org}', '{candidate}', 'recruitment_data_processing', 'v1', now());
             INSERT INTO assessment_provider_attempts (id, organization_id, candidate_id, state, provider_assignment_id)
             VALUES ('{open}', '{org}', '{candidate}', 'launched', gen_random_uuid()),
                    ('{finished}', '{org}', '{candidate}', 'result_ready', gen_random_uuid()),
                    ('{unrelated}', '{org}', '{other}', 'launched', gen_random_uuid());
             """);

        await using (var db = NewContext())
        {
            var result = await new CandidateConsentRepository(db, new ProviderConsentWithdrawalCascade()).WithdrawAsync(
                org, candidate, new WithdrawalActor(CandidateConsentFixture.AdminId, "phone", null, false, CandidateConsentConstants.StaffSource),
                DateTime.UtcNow, CancellationToken.None);
            Assert.Equal(CandidateConsentOutcome.Ok, result.Outcome);
        }

        Assert.Equal("cancelled|provider_cancel_pending|pending", await RowAsync(open));
        Assert.Equal("result_ready||pending", await RowAsync(finished));
        Assert.Equal("launched||", await RowAsync(unrelated));
        Assert.Equal(2L, await fixture.ScalarAsync<long>(
            "SELECT (metadata->>'providerAttemptsWithdrawn')::bigint FROM audit_logs WHERE entity_id = @e AND action = 'candidate_consent_withdrawn'",
            ("e", candidate.ToString())));
    }

    private async Task<string?> RowAsync(Guid attempt) => await fixture.ScalarAsync<string>(
        "SELECT state || '|' || coalesce(last_error_code, '') || '|' || coalesce(withdrawal_state, '') FROM assessment_provider_attempts WHERE id = @id",
        ("id", attempt));
}
