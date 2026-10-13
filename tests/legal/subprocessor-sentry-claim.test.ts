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
