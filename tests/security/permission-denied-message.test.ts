import { describe, expect, it, vi } from 'vitest';
import { ACTIONS, MODULES } from '@tims/shared';
import { permissionDeniedMessage } from '../../packages/api/src/lib/permission-labels';

// Permission denials reach staff verbatim (screens toast `err.message`). Before this, the message
// interpolated the raw slugs: "No tienes permiso para create en onboarding".

vi.mock('@tims/db', () => ({ db: {}, runWithTenant: (_orgId: string, fn: () => unknown) => fn() }));
vi.mock('../../packages/api/src/access', () => ({
  buildAccessForUser: vi.fn().mockResolvedValue({ allowed: false }),
  createAnchorLoader: vi.fn().mockReturnValue(null),
}));
vi.mock('../../packages/api/src/access/security-audit', () => ({
  observeDenial: vi.fn(),
  observeExternalDenial: vi.fn(),
  logSecurityEvent: vi.fn(),
}));
vi.mock('../../packages/api/src/middleware/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
  getRateLimitCategory: vi.fn().mockReturnValue('standard'),
}));

const GUIDANCE = 'Si lo necesitas, pide acceso al administrador de tu organización.';

describe('permissionDeniedMessage', () => {
  it('names the action and module in Spanish', () => {
    expect(permissionDeniedMessage('onboarding', 'create')).toBe(
      `No tienes permiso para crear en el módulo Onboarding. ${GUIDANCE}`,
    );
    expect(permissionDeniedMessage('offer', 'approve')).toBe(
      `No tienes permiso para aprobar en el módulo Ofertas. ${GUIDANCE}`,
    );
    expect(permissionDeniedMessage('candidate', 'read')).toBe(
      `No tienes permiso para ver en el módulo Candidatos. ${GUIDANCE}`,
    );
  });

  it('never prints a raw module or action slug, for every module × action', () => {
    for (const module of MODULES) {
      for (const action of ACTIONS) {
        const message = permissionDeniedMessage(module, action);
        expect(message.startsWith('No tienes permiso para '), `${module}:${action}`).toBe(true);
        // Slugs are lowercase identifiers; none may survive as a whole word in the copy.
        for (const slug of [action, module])
          expect(message, `${module}:${action}`).not.toMatch(new RegExp(`\\b${slug}\\b`));
      }
    }
  });

  it('falls back to generic copy for an unknown slug (and ignores prototype keys)', () => {
    const generic = `No tienes permiso para realizar esta acción. ${GUIDANCE}`;
    expect(permissionDeniedMessage('made_up', 'read')).toBe(generic);
    expect(permissionDeniedMessage('vacancy', 'teleport')).toBe(generic);
    expect(permissionDeniedMessage('toString', 'constructor')).toBe(generic);
  });
});

describe('trpc permission gates use the Spanish message', () => {
  const ctx = {
    user: {
      id: 'b1ffcd00-0d1c-4f09-cc7e-7cc0ce491b22',
      organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      roles: ['leader'],
      isPlatformOwner: false,
      impersonatorId: null,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
    aal: 'aal1',
  };

  async function caller() {
    const { router, permissionProcedure, anyPermissionProcedure, createCallerFactory } =
      await import('../../packages/api/src/trpc');
    const appRouter = router({
      createPlan: permissionProcedure('onboarding', 'create').mutation(() => 'ok'),
      decideOffer: anyPermissionProcedure('offer', ['approve', 'update']).mutation(() => 'ok'),
    });
    return createCallerFactory(appRouter)(ctx as never);
  }

  it('permissionProcedure denial', async () => {
    const c = await caller();
    await expect(c.createPlan()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: `No tienes permiso para crear en el módulo Onboarding. ${GUIDANCE}`,
    });
  });

  it('anyPermissionProcedure denial names the first action', async () => {
    const c = await caller();
    await expect(c.decideOffer()).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: `No tienes permiso para aprobar en el módulo Ofertas. ${GUIDANCE}`,
    });
  });
});
