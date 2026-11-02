import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Source pin: every offer transition a rejected candidate must not complete runs the guard.
// (Behaviour of the guard itself: rejected-application-guard.test.ts.)
const read = (p: string) => readFileSync(resolve(__dirname, '../../packages/api/src/routers/offer', p), 'utf8');

function procedureBody(source: string, name: string): string {
  const start = source.indexOf(`${name}:`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = source.slice(start + name.length).search(/\n  [a-zA-Z]+: /);
  return next === -1 ? source.slice(start) : source.slice(start, start + name.length + next);
}

describe('rejected-application guard wiring', () => {
  it('guards sending, accepting and converting an offer', () => {
    const signing = read('signing.ts');
    const lifecycle = read('lifecycle.ts');
    expect(procedureBody(signing, 'generateSigningLink')).toContain('await assertApplicationNotRejected(');
    expect(procedureBody(signing, 'acceptByToken')).toContain('await assertApplicationNotRejected(');
    expect(procedureBody(lifecycle, 'convertToEmployee')).toContain('await assertApplicationNotRejected(');
    expect(signing).toContain("'El candidato fue descartado en el proceso; esta oferta no se puede enviar'");
  });
});
