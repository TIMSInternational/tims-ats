using System.Text.Json.Nodes;
using Tims.Domain.Access;

namespace Tims.UnitTests.ExternalVendor;

/// <summary>
/// INV-B pin: an external API key resolves to an ORG-LEVEL access scope, so
/// <see cref="ScopeWhereFor"/> for <c>assessmentAssignment</c> yields the no-op <c>{}</c> (MatchAll) —
/// the org filter + RLS do the isolation. This pins that invariant so a future change to the
/// assessmentAssignment scope policy at organization scope (which would silently narrow or break the
/// external read surface) turns red. Narrow-scoped external keys are a deferred slice; the use case
/// fails closed rather than run unscoped if a non-MatchAll fragment ever appears.
/// </summary>
public sealed class ExternalKeyOrgScopeTests
{
    [Fact]
    public async Task AssessmentAssignment_at_org_scope_is_the_noop_match_all()
    {
        var predicate = await ScopeWhereFor.BuildAsync(
            ScopedEntity.AssessmentAssignment,
            AccessScope.Organization,
            anchors: null,
            userId: "22222222-2222-2222-2222-222222222222");

        Assert.IsType<ScopePredicate.MatchAllPredicate>(predicate);
        Assert.True(JsonNode.DeepEquals(predicate.ToJsonNode(), new JsonObject()));
    }
}
