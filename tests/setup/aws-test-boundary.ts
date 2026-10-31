/**
 * Keep Vitest isolated from a developer's or CI runner's real AWS account.
 * SDK v3 resolves AWS_ENDPOINT_URL for service clients without an explicit endpoint.
 * Production configuration is never loaded through this test-only setup file.
 */
for (const name of Object.keys(process.env)) {
  if (name.startsWith('AWS_ENDPOINT_URL_')) delete process.env[name];
}

process.env.AWS_ACCESS_KEY_ID = 'TIMS_TEST_ONLY';
process.env.AWS_SECRET_ACCESS_KEY = 'TIMS_TEST_ONLY';
process.env.AWS_SESSION_TOKEN = '';
process.env.AWS_PROFILE = '';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ENDPOINT_URL = 'http://127.0.0.1:9';
process.env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS = 'false';
process.env.AWS_EC2_METADATA_DISABLED = 'true';
process.env.BEDROCK_AWS_ACCESS_KEY_ID = 'TIMS_TEST_ONLY';
process.env.BEDROCK_AWS_SECRET_ACCESS_KEY = 'TIMS_TEST_ONLY';
