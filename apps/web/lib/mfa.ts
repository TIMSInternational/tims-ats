// The pure MFA gate logic now lives in @tims/shared (single source of truth shared
// by the (admin) page layout, the /mfa page, and the tRPC API-layer enforcement
// middleware — CB-2a). Re-exported here so existing `../../lib/mfa` imports keep
// working unchanged.
export {
  isMfaEnforced,
  isMfaSatisfied,
  isMfaPrivileged,
  isMfaGateBlocking,
  mfaMode,
  MFA_REQUIRED,
  type Aal,
  type MfaMode,
} from '@tims/shared';
