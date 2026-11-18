import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUBPROCESSORS } from '../../apps/web/lib/legal/subprocessors';

// Each claim in these rows' code-owned text is tied to the code that makes it true, so the text cannot drift
// from what the platform sends (the same pattern as the Sentry and Supabase claim tests).

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');
const row = (id: string) => {
  const found = SUBPROCESSORS.find((s) => s.id === id);
  if (!found) throw new Error(`no ${id} row`);
  return found;
};

describe('TIMS Assessments row — what the ATS sends to the assessment service', () => {
  const client = read('services/Tims.Platform/src/Tims.Infrastructure/Assessments/Providers/TimsAssessmentsClient.cs');
  const tims = row('tims-assessments');

  it('the client sends the fields the row names', () => {
    for (const field of [
      '["display_name"]',
      '"given_name"',
      '"family_name"',
      '"email"',
      '"preferred_locale"',
      '["external_ref"]',
      '["external_vacancy_ref"]',
      '["job_relatedness_reason"]',
      '["time_multiplier"]',
      '["age_band"]',
      '["proctoring"]',
      'v1/subjects/{subjectId:D}/consents',
    ]) {
      expect(client, field).toContain(field);
    }
  });

  it('names them in both locales', () => {
    expect(tims.dataCategories.en).toMatch(/Organization name/);
    expect(tims.dataCategories.en).toMatch(
      /given and family name, email address, preferred language and an internal reference/,
    );
    expect(tims.dataCategories.en).toMatch(/why it relates to the position/);
    expect(tims.dataCategories.en).toMatch(/accommodations and an age-band attestation/);
    expect(tims.dataCategories.en).toMatch(/proctoring settings/);
    expect(tims.dataCategories.es).toMatch(/nombre, apellidos, correo electrónico e idioma preferido del candidato/);
    expect(tims.dataCategories.es).toMatch(/declaración de rango de edad/);
    expect(tims.dataCategories.es).toMatch(/configuración de supervisión/);
  });

  it('says results feed the FIT score only because the API wires them into it', () => {
    expect(read('services/Tims.Platform/src/Tims.Api/Program.cs')).toMatch(/var providerResultsFeedFit/);
    expect(tims.purpose.en).toMatch(/feed the FIT score/);
    expect(tims.purpose.es).toMatch(/alimentan la puntuación FIT/);
  });
});

describe('PCA row — answered on the provider site the portal opens', () => {
  it('the portal frames or links out to timshr.com by default', () => {
    expect(read('apps/web/lib/security/csp.ts')).toContain(
      "DEFAULT_ASSESSMENT_PROVIDER_FRAME_ORIGIN = 'https://timshr.com'",
    );
    const pca = row('tims-pca');
    expect(pca.service).toContain('timshr.com');
    expect(pca.dataCategories.en).toMatch(/entered directly on that site/);
    expect(pca.dataCategories.es).toMatch(/ingresadas directamente en ese sitio/);
  });
});

describe('DynamoDB row — rate-limit keys', () => {
  const dynamo = row('aws-dynamodb');

  it('the application-confirmation key is a SHA-256 of the address, never the address', () => {
    const limiter = read('packages/api/src/middleware/rate-limit.ts');
    expect(limiter).toMatch(/createHash\('sha256'\)\.update\(recipientEmail\.trim\(\)\.toLowerCase\(\)\)/);
    expect(dynamo.dataCategories.en).toMatch(/SHA-256 hash of the email address/);
    expect(dynamo.dataCategories.es).toMatch(/hash SHA-256 de la dirección de correo/);
  });

  it('names every identifier kind the limiter keys on', () => {
    const trpc = read('packages/api/src/trpc.ts');
    expect(trpc).toContain('`ip:${ip}`');
    expect(trpc).toContain('`org:${ctx.user.organizationId}`');
    expect(trpc).toContain('`apikey:${principal.apiKeyId}`');
    expect(read('packages/api/src/routers/portal.ts')).toContain('`vacancy:${input.vacancyId.toLowerCase()}`');
    expect(dynamo.dataCategories.en).toMatch(/IP address, internal user, organization, API key or vacancy identifiers/);
  });
});

describe('Upstash row — no longer the rate limiter', () => {
  const upstash = row('upstash');

  it('the caches reach Upstash only when explicitly enabled', () => {
    expect(read('packages/ai/src/cache.ts')).toContain("process.env.AI_CACHE_UPSTASH_ENABLED === 'true'");
    expect(read('packages/api/src/lib/cache.ts')).toContain("process.env.PERMISSION_CACHE_UPSTASH_ENABLED === 'true'");
    expect(upstash.dataCategories.en).toMatch(/Only when the caches are enabled/);
    expect(upstash.dataCategories.es).toMatch(/Solo si se activan las cachés/);
  });

  it('the nonce bridge stores only the random nonce, and only while its connection string is set', () => {
    const bridge = read('services/Tims.Platform/src/Tims.Api/Http/LegacyRelayNonceBridge.cs');
    expect(bridge).toContain('$"tims:relay:nonce:{nonce}"');
    expect(bridge).toMatch(/StringSetAsync\(Key\(nonce\), "1"/);
    expect(read('services/Tims.Platform/src/Tims.Api/Program.cs')).toMatch(
      /if \(!string\.IsNullOrWhiteSpace\(legacyRedis\)\)/,
    );
    expect(upstash.dataCategories.en).toMatch(/Random single-use identifiers \(no personal data\)/);
    expect(upstash.purpose.en).not.toMatch(/^Request rate limiting/);
  });

  it('rate limiting is not routed through Upstash any more', () => {
    expect(read('packages/api/package.json')).not.toContain('@upstash/ratelimit');
    expect(read('packages/api/src/middleware/rate-limit-store.ts')).toContain('@aws-sdk/client-dynamodb');
  });
});
