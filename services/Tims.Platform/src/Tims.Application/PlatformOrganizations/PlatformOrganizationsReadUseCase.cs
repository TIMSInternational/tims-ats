namespace Tims.Application.PlatformOrganizations;

/// <summary>
/// Application layer for the platform-owner organizations READ surface (Phase-5 slice 19, issue #76).
///
/// <para>Thin by design — these three procedures have no domain rules to model. The TS side is three
/// straight Prisma reads with no kernel, so inventing one here would be a divergence dressed as
/// architecture. The only non-trivial behaviour is input normalisation for <c>listOrganizations</c>,
/// which lives in <see cref="NormalizeListQuery"/> so it can be unit-tested without a database.</para>
/// </summary>
public sealed class PlatformOrganizationsReadUseCase(IPlatformOrganizationsReadRepository repository, TimeProvider timeProvider)
{
    /// <summary>Zod bounds from <c>organizations.ts:46-57</c>, reproduced exactly.</summary>
    public const int DefaultPage = 0;

    public const int DefaultLimit = 20;
    public const int MinLimit = 1;
    public const int MaxLimit = 50;
    public const int MaxSearchLength = 200;
    public const int MaxPlanLength = 50;
    public const int MaxStatusLength = 50;

    private static readonly string[] SortableFields = ["name", "plan", "createdAt", "users"];
    private static readonly string[] SortDirections = ["asc", "desc"];

    public Task<PlatformOrganizationKpis> GetKpisAsync(CancellationToken cancellationToken) =>
        repository.GetKpisAsync(timeProvider.GetUtcNow().UtcDateTime, cancellationToken);

    public Task<PlatformOrganizationListResult> ListAsync(PlatformOrganizationListQuery query, CancellationToken cancellationToken) =>
        repository.ListAsync(NormalizeListQuery(query), cancellationToken);

    public Task<PlatformOrganizationDetail?> GetByIdAsync(Guid id, CancellationToken cancellationToken) =>
        repository.GetByIdAsync(id, cancellationToken);

    /// <summary>
    /// Applies the Zod defaults. Kept separate from validation: the ENDPOINT rejects out-of-range input
    /// with 400 (Zod parity — tRPC would throw BAD_REQUEST), while this only fills in the optional
    /// defaults Zod would have supplied. Clamping here instead of rejecting would silently accept input
    /// the TS side refuses, which is a parity divergence.
    /// </summary>
    public static PlatformOrganizationListQuery NormalizeListQuery(PlatformOrganizationListQuery query) =>
        query with
        {
            Page = query.Page < 0 ? DefaultPage : query.Page,
            Limit = query.Limit <= 0 ? DefaultLimit : query.Limit,
            Search = string.IsNullOrWhiteSpace(query.Search) ? null : query.Search,
            Plan = string.IsNullOrWhiteSpace(query.Plan) ? null : query.Plan,
            Status = string.IsNullOrWhiteSpace(query.Status) ? null : query.Status,
        };

    /// <summary>True when the value is one of the four sortable fields, or absent.</summary>
    public static bool IsValidSortBy(string? sortBy) => sortBy is null || SortableFields.Contains(sortBy);

    /// <summary>True when the value is asc/desc, or absent.</summary>
    public static bool IsValidSortDir(string? sortDir) => sortDir is null || SortDirections.Contains(sortDir);
}
