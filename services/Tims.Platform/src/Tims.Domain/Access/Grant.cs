namespace Tims.Domain.Access;

/// <summary>
/// A single role→(module,action,scope) grant, ported from types.ts. <see cref="Scope"/>
/// is kept as the RAW string (not the <see cref="AccessScope"/> enum) deliberately: it
/// crosses the DB boundary untyped, and <see cref="AccessResolver.ResolveAccess"/>
/// re-validates it via <c>IsAccessScope</c> exactly like the TS kernel — an unknown or
/// legacy scope string is dropped, never trusted.
/// </summary>
public sealed record Grant(string Role, string Module, string Action, string Scope);
