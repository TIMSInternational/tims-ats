using System.Text.Json.Nodes;

namespace Tims.Domain.Access;

/// <summary>
/// The Prisma <c>where</c>-fragment algebra produced by <see cref="ScopeWhereFor"/>.
/// Each node serializes (<see cref="ToJsonNode"/>) to exactly ONE JSON object whose shape
/// is byte-identical to the fragment the TS <c>scopeWhereFor</c> returns
/// (packages/api/src/access/entity-policies.ts) — so a shared golden fixture proves zero
/// drift between the two stacks.
///
/// Prisma key casing is reproduced verbatim: entity fields are camelCase
/// (<c>assignedTo</c>, <c>createdBy</c>, <c>teamId</c>, <c>businessUnitId</c>, <c>userId</c>,
/// <c>employeeId</c>, <c>leaderId</c>, <c>createdById</c>, <c>toUserId</c>, <c>fromUserId</c>,
/// <c>buddyId</c>, <c>responsibleId</c>, <c>currentHolderId</c>, <c>deletedAt</c>, <c>id</c>),
/// relation navs camelCase (<c>vacancy</c>, <c>applications</c>, <c>evaluators</c>), and the
/// combinator keys are <c>OR</c>/<c>AND</c>/<c>in</c>/<c>some</c> exactly as Prisma emits.
/// </summary>
public abstract record ScopePredicate
{
    private protected ScopePredicate() { }

    /// <summary>Serialize this node to its single Prisma-fragment JSON object.</summary>
    public abstract JsonNode ToJsonNode();

    /// <summary>
    /// Scalar equality <c>{ Field: Value }</c>. A null <paramref name="Value"/> emits JSON
    /// <c>null</c> — used both for <c>{ deletedAt: null }</c> and (with a non-null value) for
    /// scalar id equality like <c>{ assignedTo: "&lt;uuid&gt;" }</c>.
    /// </summary>
    public sealed record FieldEquals(string Field, string? Value) : ScopePredicate
    {
        public override JsonNode ToJsonNode() => new JsonObject { [Field] = Value is null ? null : JsonValue.Create(Value) };
    }

    /// <summary><c>{ Field: { in: [ ... ] } }</c> — list order is significant and preserved.</summary>
    public sealed record FieldIn(string Field, IReadOnlyList<string> Values) : ScopePredicate
    {
        public override JsonNode ToJsonNode()
        {
            var arr = new JsonArray();
            foreach (var v in Values) arr.Add(JsonValue.Create(v));
            return new JsonObject { [Field] = new JsonObject { ["in"] = arr } };
        }
    }

    /// <summary><c>{ OR: [ ... ] }</c> — arm order is significant and preserved.</summary>
    public sealed record Or(IReadOnlyList<ScopePredicate> Arms) : ScopePredicate
    {
        public override JsonNode ToJsonNode() => new JsonObject { ["OR"] = ArmsArray(Arms) };
    }

    /// <summary><c>{ AND: [ ... ] }</c> — arm order is significant and preserved.</summary>
    public sealed record And(IReadOnlyList<ScopePredicate> Arms) : ScopePredicate
    {
        public override JsonNode ToJsonNode() => new JsonObject { ["AND"] = ArmsArray(Arms) };
    }

    /// <summary><c>{ Nav: { some: { ... } } }</c> — a to-many relation filter.</summary>
    public sealed record RelationSome(string Nav, ScopePredicate Inner) : ScopePredicate
    {
        public override JsonNode ToJsonNode() => new JsonObject { [Nav] = new JsonObject { ["some"] = Inner.ToJsonNode() } };
    }

    /// <summary><c>{ Nav: { ... } }</c> — a to-one relation filter (no <c>some</c> wrapper).</summary>
    public sealed record RelationTo(string Nav, ScopePredicate Inner) : ScopePredicate
    {
        public override JsonNode ToJsonNode() => new JsonObject { [Nav] = Inner.ToJsonNode() };
    }

    /// <summary>The empty fragment <c>{}</c> — the organization/company early return (match everything).</summary>
    public sealed record MatchAllPredicate : ScopePredicate
    {
        public override JsonNode ToJsonNode() => new JsonObject();
    }

    /// <summary>Singleton <c>{}</c> fragment (org/company scope).</summary>
    public static readonly ScopePredicate MatchAll = new MatchAllPredicate();

    private static JsonArray ArmsArray(IReadOnlyList<ScopePredicate> arms)
    {
        var arr = new JsonArray();
        foreach (var a in arms) arr.Add(a.ToJsonNode());
        return arr;
    }
}
