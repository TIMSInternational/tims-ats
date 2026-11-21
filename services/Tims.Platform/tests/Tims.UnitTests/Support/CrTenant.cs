namespace Tims.UnitTests.Support;

/// <summary>
/// WP-02: C# copy of the Costa Rica E2E tenant constants (source of truth:
/// e2e/fixtures/cr-tenant.ts). The ids are pinned twice: CrLocaleRuntimeTests compares them with
/// Support/cr-tenant.ids.json, and tests/e2e-lib/cr-tenant-fixture.test.ts compares that JSON with
/// the TS fixture. Change all three together.
/// </summary>
public static class CrTenant
{
    public const string Currency = "CRC";
    public const string TimeZoneId = "America/Costa_Rica";
    public const string Culture = "es-CR";

    public static readonly IReadOnlyDictionary<string, string> Ids =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["organization"] = "c0570000-0000-4000-8000-000000000101",
            ["company"] = "c0570000-0000-4000-8000-000000000102",
            ["buVivienda"] = "c0570000-0000-4000-8000-000000000201",
            ["buAdministrativa"] = "c0570000-0000-4000-8000-000000000202",
            ["teamProyectos"] = "c0570000-0000-4000-8000-000000000301",
            ["teamComite"] = "c0570000-0000-4000-8000-000000000302",
            ["userSuperAdmin"] = "c0570000-0000-4000-8000-000000000401",
            ["userHrAdmin"] = "c0570000-0000-4000-8000-000000000402",
            ["userRecruiter"] = "c0570000-0000-4000-8000-000000000403",
            ["userHrbpUnit"] = "c0570000-0000-4000-8000-000000000404",
            ["userHrbpNoUnit"] = "c0570000-0000-4000-8000-000000000405",
            ["userLeader"] = "c0570000-0000-4000-8000-000000000406",
            ["userCommittee"] = "c0570000-0000-4000-8000-000000000407",
            ["userEmployee"] = "c0570000-0000-4000-8000-000000000408",
            ["userOrgAdminDeny"] = "c0570000-0000-4000-8000-000000000409",
            ["vacancyTrabajoSocial"] = "c0570000-0000-4000-8000-000000000501",
            ["vacancyAnalistaFinanciero"] = "c0570000-0000-4000-8000-000000000502",
            ["vacancyTopografia"] = "c0570000-0000-4000-8000-000000000503",
            ["candidatePortal"] = "c0570000-0000-4000-8000-000000000601",
        };

    public static Guid OrganizationId { get; } = Guid.Parse(Ids["organization"]);
}
