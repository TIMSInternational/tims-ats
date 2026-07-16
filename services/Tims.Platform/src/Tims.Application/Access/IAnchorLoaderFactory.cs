using Tims.Domain.Access;

namespace Tims.Application.Access;

/// <summary>
/// Constructs a FRESH request-local <see cref="IAnchorLoader"/> (with its own DB context) per
/// call — the C# analog of calling <c>createAnchorLoader(organizationId, userId)</c> once per
/// request (anchors.ts). SECURITY: a loader must NEVER be cached across requests (a revoked
/// leader/hrbp/evaluator must lose access on their next request), so this factory always mints a
/// new instance; the Infrastructure implementation owns and disposes the underlying context.
/// </summary>
public interface IAnchorLoaderFactory
{
    /// <summary>A fresh, request-local anchor loader scoped to one organization + user.</summary>
    IAnchorLoader Create(Guid organizationId, Guid userId);
}
