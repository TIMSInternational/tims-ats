import type { AnchorLoader } from './anchors';
import type { AccessDecision } from './types';

export * from './types';
export { resolveAccess, widestScope } from './resolve';
export { createAnchorLoader } from './anchors';
export type { AnchorLoader } from './anchors';
export { buildAccessForUser } from './build';
export type { AccessUser } from './build';

/**
 * The shape requirePermission (trpc.ts) injects as `ctx.access`: an ALLOWED
 * decision (denied requests never reach the handler) plus the request-local
 * anchor loader (null only when there is no org context, i.e. platform paths).
 */
export type AccessContext = Extract<AccessDecision, { allowed: true }> & {
  anchors: AnchorLoader | null;
};
