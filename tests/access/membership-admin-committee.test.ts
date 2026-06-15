import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const crud = () => readFileSync(join(ROOT, 'packages/api/src/routers/interview/crud.ts'), 'utf8');
const ninebox = () => readFileSync(join(ROOT, 'packages/api/src/routers/ninebox.ts'), 'utf8');

// Slice a single endpoint body out of a router source so multiline regexes
// can't bleed across endpoint boundaries. Captures from the endpoint key up to
// (but not including) the next top-level endpoint key (or EOF).
function endpointBody(src: string, name: string): string {
  const start = src.indexOf(`${name}:`);
  if (start === -1) return '';
  // The next endpoint key sits at 2-space indent: `\n  someName:`.
  const rest = src.slice(start + name.length);
  const next = rest.search(/\n {2}[a-zA-Z]\w*:\s*permissionProcedure/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('interview evaluator management', () => {
  it('addEvaluator gated by interview:update', () => {
    expect(crud()).toMatch(/addEvaluator:\s*permissionProcedure\('interview',\s*'update'\)/);
  });
  it('removeEvaluator gated by interview:update', () => {
    expect(crud()).toMatch(/removeEvaluator:\s*permissionProcedure\('interview',\s*'update'\)/);
  });
  it('addEvaluator org-verifies the evaluator user (IDOR)', () => {
    const body = endpointBody(crud(), 'addEvaluator');
    expect(body).toMatch(/user\.(findFirst|count)/);
  });
  it('addEvaluator maps duplicate to CONFLICT', () => {
    expect(crud()).toMatch(/P2002|code:\s*'CONFLICT'/);
  });

  // ── Escalation guards (codex slice-7a) ──────────────────────────────────
  // The InterviewEvaluator row is a committee-arm anchor that grants future
  // read access. A team-scoped caller must not grab an out-of-scope interview
  // by id and self-add → both endpoints must SCOPE-probe the interview parent
  // (assertScoped), not just org-check it.
  it('addEvaluator scope-probes the interview parent (no bare org-only findFirst)', () => {
    const body = endpointBody(crud(), 'addEvaluator');
    expect(body).toMatch(/assertScoped\('interview'/);
    // The escalation hole was the bare org-only parent check — it must be gone.
    expect(body).not.toMatch(/interview\.findFirst/);
  });
  it('removeEvaluator scope-probes the interview parent', () => {
    const body = endpointBody(crud(), 'removeEvaluator');
    expect(body).toMatch(/assertScoped\('interview'/);
    expect(body).not.toMatch(/interview\.findFirst/);
  });
});

describe('listCalibrations endpoint', () => {
  it('listCalibrations gated by ninebox:read', () => {
    expect(ninebox()).toMatch(/listCalibrations:\s*permissionProcedure\('ninebox',\s*'read'\)/);
  });
  it('listCalibrations is org-scoped (organizationId: ctx.user.organizationId)', () => {
    expect(ninebox()).toMatch(/organizationId:\s*ctx\.user\.organizationId/);
  });
  // Enumerating every org session is org-governance — committee members hold
  // ninebox@team and must not list all sessions.
  it('listCalibrations gates on requireOrgScope (no narrow enumeration)', () => {
    const body = endpointBody(ninebox(), 'listCalibrations');
    expect(body).toMatch(/requireOrgScope\(ctx\.access\)/);
  });
});

describe('calibration member management', () => {
  it('addCalibrationMember gated by ninebox:update', () => {
    expect(ninebox()).toMatch(/addCalibrationMember:\s*permissionProcedure\('ninebox',\s*'update'\)/);
  });
  it('removeCalibrationMember gated by ninebox:update', () => {
    expect(ninebox()).toMatch(/removeCalibrationMember:\s*permissionProcedure\('ninebox',\s*'update'\)/);
  });
  it('addCalibrationMember org-verifies the session AND the user', () => {
    const s = ninebox();
    expect(s).toMatch(/calibrationSession\.findFirst/);
    expect(s).toMatch(/user\.findFirst/);
  });
  it('addCalibrationMember maps duplicate to CONFLICT', () => {
    expect(ninebox()).toMatch(/P2002|code:\s*'CONFLICT'/);
  });

  // ── Self-promotion guard (codex slice-7a, critical) ─────────────────────
  // Calibration sessions have NO team/unit anchor. ninebox:update is held by
  // the committee role @team — without an org-gate a committee user could
  // self-add to any session and then vote. Membership writes are org-governance.
  it('addCalibrationMember gates on requireOrgScope (close self-promotion)', () => {
    const body = endpointBody(ninebox(), 'addCalibrationMember');
    expect(body).toMatch(/requireOrgScope\(ctx\.access\)/);
  });
  it('removeCalibrationMember gates on requireOrgScope', () => {
    const body = endpointBody(ninebox(), 'removeCalibrationMember');
    expect(body).toMatch(/requireOrgScope\(ctx\.access\)/);
  });

  // Tripwire: exactly the three membership-admin + list endpoints carry the
  // org-gate among the calibration-membership surface (createCalibration,
  // finalizeCalibration, getBenchStrength, getDashboardKpis also gate, so the
  // raw count is >3 — assert the three new ones each appear once).
  it('each of the three governance reads/writes gates exactly once', () => {
    for (const name of ['listCalibrations', 'addCalibrationMember', 'removeCalibrationMember']) {
      const body = endpointBody(ninebox(), name);
      const count = (body.match(/requireOrgScope\(ctx\.access\)/g) ?? []).length;
      expect(count).toBe(1);
    }
  });
});
