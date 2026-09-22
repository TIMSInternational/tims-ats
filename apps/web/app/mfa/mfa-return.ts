const INVITATION_PATH = /^\/accept-invitation\?token=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASSWORD_SETUP_PATH =
  /^\/reset-password(?:\?setup=1|\?invitation=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i;

export function safeMfaReturnTo(candidate: string | undefined): string | undefined {
  return candidate && (INVITATION_PATH.test(candidate) || PASSWORD_SETUP_PATH.test(candidate)) ? candidate : undefined;
}
