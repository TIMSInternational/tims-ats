import type { EndpointDef } from './surfaces';

/**
 * The literal placeholder a by-id endpoint carries in its `csharpPath` (as a path
 * segment) and in any `input` value that must become the concrete resource id.
 * A single canonical token — NOT the C# route's real param name — so the harness
 * substitution is uniform regardless of whether the route calls it `{userId}` /
 * `{cycleId}` / `{criticalRoleId}`. The harness never calls the C# route by
 * template; it builds a concrete URL, so `{id}` → `<uuid>` yields a valid path.
 */
export const ID_SENTINEL = '{id}';

/**
 * Returns a copy of `ep` with every `{id}` sentinel replaced by `id`:
 *  - in `csharpPath`, url-encoded and substituted into the path segment (query
 *    string is preserved untouched);
 *  - in `input`, any string value exactly equal to the sentinel becomes the RAW
 *    id (the tRPC query-string builder re-encodes it, so it must not be
 *    pre-encoded here).
 *
 * Pure + non-mutating (deep-copies `input`). Used by the parity/RBAC checks to
 * bind the ORG-A resource id; the RLS Mode-A probe substitutes the ORG-B id
 * separately in `rls.ts` (`buildProbePath`), so this is only ever the org-A path.
 */
export function substituteEndpointId(ep: EndpointDef, id: string): EndpointDef {
  return {
    ...ep,
    csharpPath: ep.csharpPath.split(ID_SENTINEL).join(encodeURIComponent(id)),
    input: substituteInInput(ep.input, id),
  };
}

function substituteInInput(input: unknown, id: string): unknown {
  if (input === ID_SENTINEL) return id;
  if (Array.isArray(input)) return input.map((v) => substituteInInput(v, id));
  if (input !== null && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) out[k] = substituteInInput(v, id);
    return out;
  }
  return input;
}
