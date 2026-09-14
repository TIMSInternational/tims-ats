import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: class { send = mocks.send; }, SendEmailCommand: class {},
}));
vi.mock('@tims/shared', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../packages/api/src/lib/circuit-breaker', () => ({ sesCircuit: { execute: (run: () => Promise<boolean>) => run() } }));
import { sendEmail } from '../../packages/api/src/lib/ses';
it('passes the abort signal to SES and reports an aborted request as unconfirmed', async () => {
  const controller = new AbortController();
  mocks.send.mockImplementation(async (_command, options) => {
    expect(options.abortSignal).toBe(controller.signal);
    throw new Error('Aborted');
  });
  controller.abort();
  expect(await sendEmail({ to: 'test@example.com', subject: 'test', html: '<p>test</p>', abortSignal: controller.signal })).toBe(false);
});
