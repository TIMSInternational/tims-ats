namespace Tims.Domain.Identity;

/// <summary>
/// The people-facing name of each staff role, for server-rendered text (invitation emails). The ONE C# map:
/// it must match <c>roles.*</c> in apps/web/lib/i18n/{es,en}.json and <c>ROLE_DEFINITIONS</c> in
/// packages/shared/src/types/roles.ts (tests/i18n/role-labels-parity.test.ts pins all three). Never print a
/// raw slug, and never the database <c>roles.name</c> (seeded separately, without accents).
/// </summary>
public static class RoleLabels
{
    private static readonly IReadOnlyDictionary<string, (string Es, string En)> Labels =
        new Dictionary<string, (string Es, string En)>(StringComparer.Ordinal)
        {
            ["super_admin"] = ("Super Administrador", "Super Administrator"),
            ["hr_admin"] = ("Administrador de RR. HH.", "HR Administrator"),
            ["hrbp"] = ("HR Business Partner (HRBP)", "HR Business Partner (HRBP)"),
            ["recruiter"] = ("Reclutador", "Recruiter"),
            ["leader"] = ("Líder", "Leader"),
            ["committee"] = ("Comité de entrevista", "Interview committee"),
            ["employee"] = ("Colaborador", "Employee"),
        };

    /// <summary>The label of <paramref name="slug"/>; an unknown value is returned without underscores.</summary>
    public static string For(string slug, string locale = "es") =>
        Labels.TryGetValue(slug, out var label) ? (locale == "en" ? label.En : label.Es) : slug.Replace('_', ' ');
}
