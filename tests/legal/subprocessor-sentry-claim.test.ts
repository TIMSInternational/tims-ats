import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUBPROCESSORS } from '../../apps/web/lib/legal/subprocessors';
import { redactBearerTokens } from '../../apps/web/lib/sentry-redact';

// The Sentry row's data-categories text is code-owned (counsel cannot edit it), so its redaction claim names
// exactly what apps/web/lib/sentry-redact.ts redacts: the bearer-link tokens (offer signing, interview join,
// AI interview) and the credential query parameters (invitation, password reset, sign-in code).

const sentry = SUBPROCESSORS.find((s) => s.id === 'sentry');
const TOKEN = 'A'.repeat(43);

describe('Sentry subprocessor redaction claim', () => {
  it.each([
    ['offer-signing link', `https://app.test/offers/sign/${TOKEN}`],
    ['interview-join link', `https://app.test/interview/join/${TOKEN}`],
    ['AI-interview link', `https://app.test/ai-interview/${TOKEN}`],
    ['invitation code', `https://app.test/accept-invitation?invitation=${TOKEN}`],
    ['password-reset code', `https://app.test/reset-password?token=${TOKEN}`],
    ['sign-in code', `https://app.test/auth/callback?code=${TOKEN}`],
  ])('the redactor scrubs the %s the row names', (_label, url) => {
    expect(redactBearerTokens(url)).not.toContain(TOKEN);
  });

  it('names each scrubbed credential, in both locales', () => {
    expect(sentry).toBeDefined();
    expect(sentry!.dataCategories.en).toMatch(/offer-signing, interview-join and AI-interview link tokens/);
    expect(sentry!.dataCategories.en).toMatch(/invitation, password-reset and sign-in codes/);
    expect(sentry!.dataCategories.en).not.toMatch(/and link tokens are scrubbed/);
    expect(sentry!.dataCategories.es).toMatch(
      /tokens de enlace para firmar ofertas, para unirse a entrevistas y de entrevistas con IA/,
    );
    expect(sentry!.dataCategories.es).toMatch(
      /códigos de invitación, de restablecimiento de contraseña y de inicio de sesión/,
    );
  });
});

// sendDefaultPii: false does not strip what the code attaches explicitly. The tRPC route sends the signed-in
// user's and organization's internal ids as Sentry extras on server errors (tier-1 review), so the row must
// say so; if the route stops sending them, this test says the text can drop the sentence.
describe('Sentry subprocessor row discloses the identifiers the code sends', () => {
  const route = readFileSync(resolve(__dirname, '../../apps/web/app/api/trpc/[trpc]/route.ts'), 'utf8');
  const base = /const base = \{([\s\S]*?)\};/.exec(route)?.[1] ?? '';
  const sendsBase = /Sentry\.captureException\([^)]*extra: base/.test(route);
  const sendsIds = sendsBase && /\buserId:/.test(base) && /\borgId:/.test(base);

  it('the route really sends user and organization ids to Sentry (keeps this test honest)', () => {
    expect(sendsIds, 'route.ts no longer sends userId/orgId to Sentry: drop the identifier sentence from the row').toBe(
      true,
    );
  });

  it('names those identifiers and the error message, in both locales', () => {
    expect(sentry!.dataCategories.en).toMatch(/internal identifiers of the signed-in user and of their organization/);
    expect(sentry!.dataCategories.es).toMatch(
      /identificadores internos del usuario que inició sesión y de su organización/,
    );
    expect(sentry!.dataCategories.en).toMatch(/error message/);
    expect(sentry!.dataCategories.es).toMatch(/mensaje de error/);
  });
});
