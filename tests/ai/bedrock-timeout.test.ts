import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The raw Bedrock call must be bounded by a hard deadline that covers the whole
// operation (including SDK retry backoff, which ignores the abort signal), and
// a timeout must surface as the typed BedrockTimeoutError.
const generateTextMock = vi.fn();
// 'ai' is aliased in vitest.config.ts to packages/ai's copy so this mock
// intercepts the generateText import in client.ts.
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateTextMock(...a) }));

import { bedrockGenerate, BedrockTimeoutError, BEDROCK_TIMEOUT_MS } from '../../packages/ai/src/client';

describe('bedrockGenerate timeout', () => {
  beforeEach(() => {
    generateTextMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses a 20 second ceiling', () => {
    expect(BEDROCK_TIMEOUT_MS).toBe(20_000);
  });

  it('passes an abort signal to generateText and aborts it at the deadline', async () => {
    let signal: AbortSignal | undefined;
    generateTextMock.mockImplementation(({ abortSignal }: { abortSignal: AbortSignal }) => {
      signal = abortSignal;
      return new Promise(() => undefined);
    });
    const pending = bedrockGenerate('haiku', 'sys', 'msg', 100);
    const assertion = expect(pending).rejects.toBeInstanceOf(BedrockTimeoutError);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(BEDROCK_TIMEOUT_MS);
    await assertion;
    expect(signal?.aborted).toBe(true);
  });

  it('rejects at the deadline even when the SDK ignores the abort (retry backoff)', async () => {
    // Never settles and never listens to the signal — like a retry sleep.
    generateTextMock.mockImplementation(() => new Promise(() => undefined));
    const pending = bedrockGenerate('haiku', 'sys', 'msg', 100);
    const assertion = expect(pending).rejects.toBeInstanceOf(BedrockTimeoutError);
    await vi.advanceTimersByTimeAsync(BEDROCK_TIMEOUT_MS - 1);
    let settled = false;
    pending.catch(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
  });

  it('returns normally when the call finishes before the deadline', async () => {
    generateTextMock.mockResolvedValue({ text: '{}', usage: { promptTokens: 3, completionTokens: 2 } });
    const r = await bedrockGenerate('haiku', 'sys', 'msg', 100);
    expect(r).toMatchObject({ text: '{}', inputTokens: 3, outputTokens: 2 });
  });

  it('rethrows non-timeout errors unchanged', async () => {
    generateTextMock.mockRejectedValue(new Error('AccessDenied'));
    await expect(bedrockGenerate('haiku', 'sys', 'msg', 100)).rejects.toThrow('AccessDenied');
  });
});
