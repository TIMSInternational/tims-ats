namespace Tims.Domain.Assessments.Providers;

/// <summary>
/// The ATS's own short notice a candidate reads in the portal before the provider's consent texts, every time a sitting
/// that has not started yet is launched (round 12). Its wording lives in apps/web (<c>assessmentConsentNotice</c>, es/en)
/// and is versioned here: changing a word means a new version in BOTH places (pinned by
/// tests/assessment/ats-notice-version.test.tsx). The launch records which version, in which language, the candidate
/// acknowledged (audit action <c>assessment_provider_notice_acknowledged</c>).
/// </summary>
public static class AtsNotice
{
    public const string CurrentVersion = "2026-11-09-ats-notice-v1";

    /// <summary>The versions a launch accepts: only the current one (an old tab must reload and read the current text).</summary>
    public static readonly IReadOnlyList<string> Versions = [CurrentVersion];

    public static readonly IReadOnlyList<string> Locales = ["es", "en"];

    public static bool IsKnown(string? version) =>
        version is not null && Versions.Contains(version, StringComparer.Ordinal);

    public static bool IsLocale(string? locale) =>
        locale is not null && Locales.Contains(locale, StringComparer.Ordinal);
}
