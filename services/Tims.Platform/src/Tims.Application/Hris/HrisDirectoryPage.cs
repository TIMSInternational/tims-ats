using Tims.Domain.Hris;

namespace Tims.Application.Hris;

/// <summary>
/// One page of a directory fetch: the provider-neutral <see cref="HrisSourceEmployee"/> records on
/// this page, plus the cursor to fetch the NEXT page (<see cref="Next"/> is null when the directory is
/// exhausted). BambooHR yields exactly one page with a null <see cref="Next"/>.
/// </summary>
public sealed record HrisDirectoryPage(
    IReadOnlyList<HrisSourceEmployee> Employees,
    HrisFetchCursor? Next);
