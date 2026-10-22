import { describe, expect, it, vi } from 'vitest';

// #330 tier-1 (Codex) review: the response recorder's promise was discarded, and a 207 batch is
// classified only after its JSON body arrives, so the synchronous check could pass before the refusal
// was recorded (blaming the next test, or escaping entirely after the last one).

vi.mock('@playwright/test', () => ({ expect: vi.fn() }));

import { closePersona, expectNotRateLimited, newPersona } from '../../e2e/lib/persona';

type Handler = (arg: unknown) => void;

function fakeBrowser() {
  const handlers: Record<string, Handler[]> = {};
  const context = {
    route: vi.fn(async () => undefined),
    newPage: vi.fn(async () => ({})),
    on: (event: string, h: Handler) => {
      (handlers[event] ??= []).push(h);
    },
    close: vi.fn(async () => undefined),
  };
  const browser = { newContext: vi.fn(async () => context) };
  return { browser, emit: (event: string, arg: unknown) => handlers[event]?.forEach((h) => h(arg)) };
}

/** A 207 batch whose body resolves only when `release` is called. */
function slowRefusal() {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const response = {
    url: () => 'http://localhost:3000/api/trpc/offer.list,offer.kpis',
    status: () => 207,
    json: async () => {
      await gate;
      return [{ result: {} }, { error: { json: { data: { code: 'TOO_MANY_REQUESTS' } } } }];
    },
  };
  return { response, release };
}

describe('e2e persona rate-limit recorder', () => {
  it('a refusal whose body is still being read fails the check (it waits for the recorder)', async () => {
    const { browser, emit } = fakeBrowser();
    const persona = await newPersona(browser as never, 'recruiter');
    const { response, release } = slowRefusal();
    emit('response', response);
    const check = expectNotRateLimited(persona);
    setTimeout(release, 20);
    await expect(check).rejects.toThrow(/TOO_MANY_REQUESTS on offer\.kpis/);
  });

  it('a refusal still in flight when the journey ends is reported by closePersona', async () => {
    const { browser, emit } = fakeBrowser();
    const persona = await newPersona(browser as never, 'recruiter');
    const { response, release } = slowRefusal();
    emit('response', response);
    setTimeout(release, 20);
    await expect(closePersona(persona)).rejects.toThrow(/rate limit/);
  });

  it('a request whose response has not even arrived when teardown starts is still checked (tier-1 r2)', async () => {
    const { browser, emit } = fakeBrowser();
    const persona = await newPersona(browser as never, 'recruiter');
    const request = { url: () => 'http://localhost:3000/api/trpc/offer.list,offer.kpis' };
    emit('request', request);
    const closing = closePersona(persona);
    const { response, release } = slowRefusal();
    setTimeout(() => {
      emit('response', response);
      release();
      setTimeout(() => emit('requestfinished', request), 10);
    }, 30);
    await expect(closing).rejects.toThrow(/TOO_MANY_REQUESTS on offer\.kpis/);
  });

  it('a 207 whose body cannot be read is surfaced, never accepted silently (tier-1 r2)', async () => {
    const { browser, emit } = fakeBrowser();
    const persona = await newPersona(browser as never, 'recruiter');
    emit('response', {
      url: () => 'http://localhost:3000/api/trpc/offer.list,offer.kpis',
      status: () => 207,
      json: async () => {
        throw new Error('Target page, context or browser has been closed');
      },
    });
    await expect(expectNotRateLimited(persona)).rejects.toThrow(/could not be read/);
  });

  it('no refusal: the check passes', async () => {
    const { browser, emit } = fakeBrowser();
    const persona = await newPersona(browser as never, 'recruiter');
    emit('response', { url: () => 'http://localhost:3000/api/trpc/offer.list', status: () => 200, json: async () => [] });
    await expect(expectNotRateLimited(persona)).resolves.toBeUndefined();
  });
});
