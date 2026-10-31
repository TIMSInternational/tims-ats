import { expect, it } from 'vitest';
import { SESClient } from '../../packages/api/node_modules/@aws-sdk/client-ses';

it('uses only dummy AWS credentials and a loopback SDK endpoint in unit tests', async () => {
  const client = new SESClient({ region: 'us-east-1' });
  try {
    expect(await client.config.credentials()).toMatchObject({ accessKeyId: 'TIMS_TEST_ONLY' });
    expect(await client.config.serviceConfiguredEndpoint?.()).toBe('http://127.0.0.1:9');
  } finally {
    client.destroy();
  }
});
