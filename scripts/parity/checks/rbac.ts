import type { EndpointDef } from '../surfaces';

export interface CheckResult {
  check: 'rbac';
  endpoint: string;
  role: string;
  ok: boolean;
  detail?: string;
}

/** C# live caller shape, matching `callCsharp` in scripts/parity/callers.ts exactly:
 * a plain GET against `${base}${path}` with `Authorization: Bearer <token>`. */
export type CallCsharp = (base: string, path: string, token: string) => Promise<{ status: number; body: unknown }>;

export interface RbacContext {
  base: string;
  tokensByRole: Record<string, string>;
}

/**
 * Pure verdict function: determines if a role's HTTP status matches the expected value.
 *
 * Returns ok:true when actual === expected (both 200 or both 403).
 * Returns ok:false with detail containing role + both statuses when they mismatch.
 * Privilege escalation (denied role getting 200) is detected as a mismatch.
 */
export function verdictForRole(role: string, expected: 200 | 403, actual: number): Omit<CheckResult, 'endpoint'> {
  const statusMatch = actual === expected;

  if (statusMatch) {
    return { check: 'rbac', role, ok: true };
  }

  return {
    check: 'rbac',
    role,
    ok: false,
    detail: `rbac: role '${role}' expected ${expected} but got ${actual}`,
  };
}

/**
 * Live RBAC check: for each role in `ep.expectedByRole`, calls C# with that role's token
 * and asserts the HTTP status matches the expected value (200 allow / 403 deny).
 * Returns an array of CheckResults, one per role.
 *
 * If a role is in `ep.expectedByRole` but has no token in `ctx.tokensByRole`,
 * fails closed with ok:false and a detail mentioning the missing token.
 */
export async function runRbacEndpoint(
  ep: EndpointDef,
  ctx: RbacContext,
  callCsharp: CallCsharp,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  for (const [role, expectedStatus] of Object.entries(ep.expectedByRole)) {
    const token = ctx.tokensByRole[role];

    // FAIL CLOSED: missing token for a role
    if (!token) {
      results.push({
        check: 'rbac',
        endpoint: ep.name,
        role,
        ok: false,
        detail: `rbac: role '${role}' has no token in tokensByRole`,
      });
      continue;
    }

    try {
      const response = await callCsharp(ctx.base, ep.csharpPath, token);
      const verdict = verdictForRole(role, expectedStatus, response.status);

      results.push({
        check: 'rbac',
        endpoint: ep.name,
        role,
        ok: verdict.ok,
        detail: verdict.detail,
      });
    } catch (err) {
      // FAIL CLOSED: call itself failed (network error, etc.)
      results.push({
        check: 'rbac',
        endpoint: ep.name,
        role,
        ok: false,
        detail: `rbac: call failed for role '${role}': ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return results;
}
