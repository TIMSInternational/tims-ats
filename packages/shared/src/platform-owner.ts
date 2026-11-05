// ---------------------------------------------------------------------------
// One synchronization boundary for the platform-owner allowlist (pure)
// ---------------------------------------------------------------------------
// An allowlisted email becomes a platform owner on its first sign-in (the tRPC context builder and the auth
// callback create the owner row), and removing the email revokes the owner flag of an account created from
// it (platform.removePlatformOwnerEmail). Both sides take a transaction-level advisory lock on this key
// before they read the allowlist, so a sign-in can never pass the allowlist check, wait while the removal
// commits with nothing to revoke, and then create an owner for an address that is no longer listed.

/** Advisory-lock key for one allowlist address (case-insensitive, like the removal). */
export function platformOwnerEmailLockKey(email: string): string {
  return `platform-owner-email:${email.trim().toLowerCase()}`;
}
