import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The raw Bedrock call must carry an abort signal with a hard timeout, and an
// abort must surface as the typed BedrockTimeoutError that invokeAgent degrades on.
const generateTextMock = vi.fn();
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateTextMock(...a) }));
vi.mock('@ai-sdk/amazon-bedrock', () => ({ createAmazonBedrock: () => (id: string) => ({ modelId: id }) }));

import { bedrockGenerate, BedrockTimeoutError, BEDROCK_TIMEOUT_MS } from '../../packages/ai/src/client';

describe('bedrockGenerate timeout', () => {
  let controller: AbortController;
  let timeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    generateTextMock.mockReset();
    controller = new AbortController();
    timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => controller.signal);
  });

  afterEach(() => {
    timeoutSpy.mockRestore();
  });

  it('uses a 20 second ceiling', () => {
    expect(BEDROCK_TIMEOUT_MS).toBe(20_000);
  });

  it('passes an AbortSignal.timeout(BEDROCK_TIMEOUT_MS) signal to generateText', async () => {
    generateTextMock.mockResolvedValue({ text: '{}', usage: { promptTokens: 1, completionTokens: 1 } });
    await bedrockGenerate('haiku', 'sys', 'msg', 100);
    expect(timeoutSpy).toHaveBeenCalledWith(BEDROCK_TIMEOUT_MS);
    expect(generateTextMock.mock.calls[0]?.[0]).toMatchObject({ abortSignal: controller.signal });
  });

  it('turns an aborted (hung) call into BedrockTimeoutError instead of waiting', async () => {
    generateTextMock.mockImplementation(
      ({ abortSignal }: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          abortSignal.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
          );
        }),
    );
    const pending = bedrockGenerate('haiku', 'sys', 'msg', 100);
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(BedrockTimeoutError);
  });

  it('rethrows non-timeout errors unchanged', async () => {
    generateTextMock.mockRejectedValue(new Error('AccessDenied'));
    await expect(bedrockGenerate('haiku', 'sys', 'msg', 100)).rejects.toThrow('AccessDenied');
  });
});
