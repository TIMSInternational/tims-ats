using Microsoft.EntityFrameworkCore;
using Tims.Application.Access;
using Tims.Domain.Access;

namespace Tims.Infrastructure.Access;

/// <summary>
/// Mints a FRESH <see cref="EfAnchorLoader"/> per call, each with its OWN <see cref="AnchorDbContext"/>
/// (created from the registered <see cref="IDbContextFactory{TContext}"/>). This is what keeps
/// anchors request-local and never cached across requests — the loader owns and disposes its context.
/// </summary>
public sealed class EfAnchorLoaderFactory(IDbContextFactory<AnchorDbContext> contextFactory)
    : IAnchorLoaderFactory
{
    public IAnchorLoader Create(Guid organizationId, Guid userId) =>
        new EfAnchorLoader(contextFactory.CreateDbContext(), organizationId, userId);
}
