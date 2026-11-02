import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUBPROCESSORS } from '../../apps/web/lib/legal/subprocessors';
import { redactJoinTokens } from '../../apps/web/lib/sentry-redact';

// The Sentry row's data-categories text is code-owned (counsel cannot edit it), so its redaction claim names
// exactly what apps/web/lib/sentry-redact.ts redacts: interview-join link tokens.

const sentry = SUBPROCESSORS.find((s) => s.id === 'sentry');
const TOKEN = 'A'.repeat(43);

describe('Sentry subprocessor redaction claim', () => {
  it('the redactor scrubs interview-join tokens (the scope the row claims)', () => {
    expect(redactJoinTokens(`/interview/join/${TOKEN}`)).not.toContain(TOKEN);
  });

  it('names interview-join link tokens specifically, in both locales', () => {
    expect(sentry).toBeDefined();
    expect(sentry!.dataCategories.en).toMatch(/interview-join link tokens/);
    expect(sentry!.dataCategories.en).not.toMatch(/and link tokens are scrubbed/);
    expect(sentry!.dataCategories.es).toMatch(/tokens de enlace para unirse a entrevistas/);
    expect(sentry!.dataCategories.es).not.toMatch(/y los tokens de enlace se eliminan/);
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
    expect(sendsIds, 'route.ts no longer sends userId/orgId to Sentry: drop the identifier sentence from the row').toBe(true);
  });

  it('names those identifiers and the error message, in both locales', () => {
    expect(sentry!.dataCategories.en).toMatch(/internal identifiers of the signed-in user and of their organization/);
    expect(sentry!.dataCategories.es).toMatch(/identificadores internos del usuario que inició sesión y de su organización/);
    expect(sentry!.dataCategories.en).toMatch(/error message/);
    expect(sentry!.dataCategories.es).toMatch(/mensaje de error/);
  });
});
