/**
 * The platform sender defaults to the TIMS-owned domain when PLATFORM_EMAIL_FROM is unset, and the
 * env var still overrides it. Only the AWS SDK transport and the logger are faked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ send: vi.fn(), commands: [] as Array<Record<string, unknown>> }));
vi.mock('../../packages/api/node_modules/@aws-sdk/client-ses', () => ({
  SESClient: class {
    send = mocks.send;
  },
  SendEmailCommand: class {
    constructor(input: Record<string, unknown>) {
      mocks.commands.push(input);
    }
  },
  SendRawEmailCommand: class {},
}));
vi.mock('@tims/shared', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

async function sendWith(from: string | undefined): Promise<unknown> {
  vi.resetModules();
  mocks.commands.length = 0;
  mocks.send.mockResolvedValue({});
  vi.stubEnv('PLATFORM_EMAIL_FROM', from ?? '');
  const { sendEmail } = await import('../../packages/api/src/lib/ses');
  await expect(sendEmail({ to: 'qa@example.test', subject: 's', html: '<p>h</p>' })).resolves.toBe(true);
  return mocks.commands[0]?.Source;
}

describe('lib/ses sender address', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to noreply@timssuite.com when PLATFORM_EMAIL_FROM is unset', async () => {
    expect(await sendWith(undefined)).toBe('noreply@timssuite.com');
  });

  it('uses PLATFORM_EMAIL_FROM when it is set', async () => {
    expect(await sendWith('mailer@example.test')).toBe('mailer@example.test');
  });
});
