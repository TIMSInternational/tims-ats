export const PASSWORD_SETUP_PROOF_COOKIE = 'tims-password-setup-proof';
export const PASSWORD_SETUP_PROOF_PATH = '/api/auth/password-setup';

export function isPasswordSetupProof(value: string | null): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
