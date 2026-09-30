using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.OrgStructure;

namespace Tims.Api.OrgStructure;

/// <summary>
/// Strict body parsing for the org-structure writes. PATCH needs three states per field (absent / null /
/// value), which model binding cannot express, so bodies are read as a <see cref="JsonObject"/>. Unknown
/// keys are rejected: a misspelt field (<c>leaderId</c> for <c>leaderUserId</c>) must be a 400, not a
/// silent no-op. Text bounds are enforced again by the use case.
/// </summary>
public static class OrgStructureBodies
{
    public static bool TryCreateBusinessUnit(JsonObject body, out CreateBusinessUnitInput input)
    {
        input = new(string.Empty, null, null);
        if (!OnlyKeys(body, "name", "code", "companyId")
            || !TryString(body, "name", nullable: false, out var name) || !name.IsSet
            || !TryString(body, "code", nullable: true, out var code)
            || !TryGuid(body, "companyId", nullable: true, out var companyId))
        {
            return false;
        }

        input = new(name.Value!, code.Value, companyId.Value);
        return true;
    }

    public static bool TryUpdateBusinessUnit(JsonObject body, out UpdateBusinessUnitInput input)
    {
        input = new(default, default, default);
        if (!OnlyKeys(body, "name", "code", "isActive")
            || !TryString(body, "name", nullable: false, out var name)
            || !TryString(body, "code", nullable: true, out var code)
            || !TryBool(body, "isActive", out var isActive))
        {
            return false;
        }

        input = new(name.IsSet ? Optional<string>.Of(name.Value!) : default, code, isActive);
        return true;
    }

    public static bool TryCreateTeam(JsonObject body, out CreateTeamInput input)
    {
        input = new(Guid.Empty, string.Empty, null);
        if (!OnlyKeys(body, "businessUnitId", "name", "leaderUserId")
            || !TryGuid(body, "businessUnitId", nullable: false, out var unitId) || !unitId.IsSet
            || !TryString(body, "name", nullable: false, out var name) || !name.IsSet
            || !TryGuid(body, "leaderUserId", nullable: true, out var leader))
        {
            return false;
        }

        input = new(unitId.Value!.Value, name.Value!, leader.Value);
        return true;
    }

    public static bool TryUpdateTeam(JsonObject body, out UpdateTeamInput input)
    {
        input = new(default, default, default);
        if (!OnlyKeys(body, "name", "isActive", "leaderUserId")
            || !TryString(body, "name", nullable: false, out var name)
            || !TryBool(body, "isActive", out var isActive)
            || !TryGuid(body, "leaderUserId", nullable: true, out var leader))
        {
            return false;
        }

        input = new(name.IsSet ? Optional<string>.Of(name.Value!) : default, isActive, leader);
        return true;
    }

    /// <summary>
    /// True when a PATCH team body sets or clears ONLY <c>leaderUserId</c> — the one team field people management
    /// (<c>user:update</c>) may write. Anything else (or an unreadable body) takes the structure gate.
    /// </summary>
    public static bool IsLeaderOnlyTeamUpdate(JsonObject? body)
    {
        if (body is null) return false;
        try
        {
            return body.Count == 1 && body.ContainsKey("leaderUserId");
        }
        catch (ArgumentException)
        {
            return false; // duplicate keys: never relax the gate on a body the parser cannot trust
        }
    }

    public static bool TryMemberRole(JsonObject body, out string? role)
    {
        role = null;
        if (!OnlyKeys(body, "role") || !TryString(body, "role", nullable: false, out var value)) return false;
        role = value.Value;
        return true;
    }

    /// <summary><c>businessUnitId</c> is REQUIRED (explicit null clears) so an empty body cannot clear it.</summary>
    public static bool TryUserBusinessUnit(JsonObject body, out Guid? businessUnitId)
    {
        businessUnitId = null;
        if (!OnlyKeys(body, "businessUnitId") || !TryGuid(body, "businessUnitId", nullable: true, out var value)
            || !value.IsSet)
        {
            return false;
        }

        businessUnitId = value.Value;
        return true;
    }

    private static bool OnlyKeys(JsonObject body, params string[] allowed) =>
        body.All(pair => allowed.Contains(pair.Key, StringComparer.Ordinal));

    private static bool TryString(JsonObject body, string key, bool nullable, out Optional<string?> value)
    {
        value = default;
        if (!body.TryGetPropertyValue(key, out var node)) return true;
        if (node is null)
        {
            value = Optional<string?>.Of(null);
            return nullable;
        }

        if (node is not JsonValue json || json.GetValueKind() != JsonValueKind.String) return false;
        var text = json.GetValue<string>();
        // Pre-trim ceiling: the domain bounds apply after trimming, this stops megabyte strings early.
        if (text.Length > OrgStructureLimits.MaxNameLength * 4) return false;
        value = Optional<string?>.Of(text);
        return true;
    }

    private static bool TryGuid(JsonObject body, string key, bool nullable, out Optional<Guid?> value)
    {
        value = default;
        if (!TryString(body, key, nullable, out var text)) return false;
        if (!text.IsSet) return true;
        if (text.Value is null)
        {
            value = Optional<Guid?>.Of(null);
            return true;
        }

        if (!Guid.TryParseExact(text.Value, "D", out var parsed)) return false;
        value = Optional<Guid?>.Of(parsed);
        return true;
    }

    private static bool TryBool(JsonObject body, string key, out Optional<bool> value)
    {
        value = default;
        if (!body.TryGetPropertyValue(key, out var node)) return true;
        if (node is not JsonValue json) return false;
        var kind = json.GetValueKind();
        if (kind is not (JsonValueKind.True or JsonValueKind.False)) return false;
        value = Optional<bool>.Of(kind == JsonValueKind.True);
        return true;
    }
}

// OpenAPI request schemas (the handlers parse defensively from JsonObject; these document the contract).
public sealed record CreateBusinessUnitBody([property: Required] string Name, string? Code = null, Guid? CompanyId = null);

public sealed record UpdateBusinessUnitBody(string? Name = null, string? Code = null, bool? IsActive = null);

public sealed record CreateTeamBody([property: Required] Guid BusinessUnitId, [property: Required] string Name, Guid? LeaderUserId = null);

public sealed record UpdateTeamBody(string? Name = null, bool? IsActive = null, Guid? LeaderUserId = null);

public sealed record PutTeamMemberBody(string? Role = null);

public sealed record SetUserBusinessUnitBody([property: Required] Guid? BusinessUnitId);
