import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUBPROCESSORS } from '../../apps/web/lib/legal/subprocessors';

// The /legal/subprocessors table is generated from apps/web/lib/legal/subprocessors.ts. This test
// keeps that list honest in BOTH directions:
//   1. every listed vendor's evidence still exists in the code (no stale entries);
//   2. every runtime dependency, .NET package and outbound host in the code is classified —
//      either as a listed vendor or as an explicit, reasoned non-vendor — so adding a new SDK, or an
//      API host written as a LITERAL https/wss URL in source, without updating the list fails here.
//   NOT covered (tier-1 review): an endpoint whose URL comes only from configuration (an env var or a
//   secret) is invisible to a source scan. Such a vendor needs its activating variable in `activatedBy`
//   and a reviewer; the "configured" check below only proves listed variables are still read.

const ROOT = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const ids = new Set(SUBPROCESSORS.map((s) => s.id));

// ---------------------------------------------------------------------------------------------
// Classification tables. A string value is a SUBPROCESSORS id; an object is a non-vendor + reason.
// ---------------------------------------------------------------------------------------------
type Classification = string | { notAVendor: string };
const lib = (reason = 'in-process library; sends no data to a third party') => ({ notAVendor: reason });

const NPM_DEPENDENCIES: Record<string, Classification> = {
  '@supabase/ssr': 'supabase',
  '@supabase/supabase-js': 'supabase',
  '@prisma/client': 'supabase',
  '@sentry/nextjs': 'sentry',
  '@elevenlabs/react': 'elevenlabs',
  '@daily-co/daily-js': 'daily',
  '@daily-co/daily-react': 'daily',
  '@ai-sdk/amazon-bedrock': 'aws-bedrock',
  '@aws-sdk/client-s3': 'aws-s3',
  '@aws-sdk/s3-presigned-post': 'aws-s3',
  '@aws-sdk/client-ses': 'aws-ses',
  '@upstash/redis': 'upstash',
  '@upstash/ratelimit': 'upstash',
  stripe: 'stripe',
  ai: lib('provider-agnostic AI SDK core; the network call is made by @ai-sdk/amazon-bedrock'),
  '@hello-pangea/dnd': lib(),
  '@hookform/resolvers': lib(),
  '@tanstack/react-query': lib(),
  '@tanstack/react-table': lib(),
  '@trpc/client': lib(),
  '@trpc/next': lib(),
  '@trpc/react-query': lib(),
  '@trpc/server': lib(),
  'class-variance-authority': lib(),
  clsx: lib(),
  exceljs: lib(),
  'lucide-react': lib(),
  mammoth: lib(),
  next: lib('framework; hosting is the Vercel entry (apps/web/vercel.json)'),
  'next-intl': lib(),
  'pdf-parse': lib(),
  pdfkit: lib(),
  pino: lib(),
  react: lib(),
  'react-dom': lib(),
  'react-hook-form': lib(),
  recharts: lib(),
  'server-only': lib(),
  superjson: lib(),
  'tailwind-merge': lib(),
  zod: lib(),
};

const NUGET_PACKAGES: Record<string, Classification> = {
  'AWSSDK.SimpleEmail': 'aws-ses',
  // C# CV pipeline: Converse calls for CV parsing and reads of uploaded CV objects.
  'AWSSDK.BedrockRuntime': 'aws-bedrock',
  'AWSSDK.S3': 'aws-s3',
  // Platform health check: Bedrock control-plane reachability probe (no personal data sent).
  'AWSSDK.Bedrock': 'aws-bedrock',
  'Stripe.net': 'stripe',
  // Program.cs: the C# rate limiter shares the Upstash Redis instance over its TCP endpoint.
  'StackExchange.Redis': 'upstash',
  'Npgsql.EntityFrameworkCore.PostgreSQL': 'supabase',
  'OpenTelemetry.Exporter.OpenTelemetryProtocol': lib(
    'exports traces/metrics only to an operator-configured OTLP collector (unset by default); a third-party backend there would need a new entry',
  ),
  'OpenTelemetry.Extensions.Hosting': lib(),
  'OpenTelemetry.Instrumentation.AspNetCore': lib(),
  'Microsoft.AspNetCore.Authentication.JwtBearer': lib(),
  'Microsoft.AspNetCore.OpenApi': lib(),
  'Microsoft.EntityFrameworkCore.Design': lib(),
  'Microsoft.Extensions.ApiDescription.Server': lib(),
  'Microsoft.Extensions.Http.Resilience': lib(),
  'Microsoft.Extensions.Logging.Console': lib(),
  'Microsoft.OpenApi': lib(),
  PdfPig: lib('in-process PDF text extraction for CV parsing'),
  Quartz: lib(),
  'Quartz.Extensions.Hosting': lib(),
  'Quartz.Serialization.SystemTextJson': lib(),
  'Serilog.AspNetCore': lib(),
  'Serilog.Formatting.Compact': lib(),
  'SSH.NET': lib('version pin for a transitive test dependency; no runtime use'),
  // Test-only packages (test projects never ship).
  'coverlet.collector': lib('test only'),
  'Microsoft.AspNetCore.Mvc.Testing': lib('test only'),
  'Microsoft.NET.Test.Sdk': lib('test only'),
  'Testcontainers.PostgreSql': lib('test only'),
  'Testcontainers.Redis': lib('test only'),
  xunit: lib('test only'),
  'xunit.runner.visualstudio': lib('test only'),
};

// Host -> classification, EXACT hosts only. Suffix rules kept failing tier-1 review one platform at a time
// (vercel.app, cloudfront.net, amazonaws.com, supabase.co, livekit.cloud): those platforms host other
// customers' projects, so `foreign.livekit.cloud` or `parser.execute-api.<region>.amazonaws.com` is a
// different processor, or a different account of one. Every host the source references is listed and
// reviewed here; a new one fails "every https/wss host referenced in source is classified" until someone
// decides what it is. Literal CSP wildcards (`*.daily.co`) are allowances, not hosts data is sent to.
const NOT_DATA = (why: string): Classification => ({ notAVendor: why });
const HOSTS = new Map<string, Classification>([
  ['tims-ats.vercel.app', 'vercel'],
  ['tims-cv.s3.us-west-2.amazonaws.com', 'aws-s3'],
  ['challenges.cloudflare.com', 'cloudflare-turnstile'],
  ['api.daily.co', 'daily'],
  ['meet.daily.co', NOT_DATA('sample meeting link in an email preview')],
  ['domain.daily.co', NOT_DATA('placeholder in a code comment (DOMAIN.daily.co)')],
  ['prod-ks.pluot.blue', 'daily'],
  ['elevenlabs.io', 'elevenlabs'],
  ['api.elevenlabs.io', 'elevenlabs'],
  ['api.bamboohr.com', 'bamboohr'],
  ['*.supabase.co', 'supabase'],
  ['*.daily.co', 'daily'],
  ['*.wss.daily.co', 'daily'],
  ['*.dailywebrtc.com', 'daily'],
  ['*.dailywebrtc.net', 'daily'],
  ['*.elevenlabs.io', 'elevenlabs'],
  // @elevenlabs/client depends on livekit-client: the WebRTC transport of the ElevenLabs session.
  ['*.livekit.cloud', 'elevenlabs'],
  ['*.sentry.io', 'sentry'],
  ['*.cloudfront.net', NOT_DATA('img-src allowance only; the browser fetches images, no data is sent')],
  ['*.googleusercontent.com', NOT_DATA('img-src allowance for identity-provider profile pictures')],
  ['accounts.google.com', NOT_DATA('sign-in identity provider chosen by the user (counsel TODO on the page)')],
  ['login.microsoftonline.com', NOT_DATA('sign-in identity provider chosen by the user (counsel TODO on the page)')],
  ['fonts.googleapis.com', NOT_DATA('CSP allowance only; next/font self-hosts fonts at build time')],
  ['fonts.gstatic.com', NOT_DATA('CSP allowance only; next/font self-hosts fonts at build time')],
  ['open.er-api.com', NOT_DATA('public exchange-rate feed; no personal data is sent')],
  ['api.frankfurter.dev', NOT_DATA('public exchange-rate feed; no personal data is sent')],
  ['linkedin.com', NOT_DATA('input placeholder text only')],
  ['portal.invalid', NOT_DATA('reserved .invalid base URL used for URL parsing')],
  ['storage.tims.app', NOT_DATA('mock URL string in a stub service')],
]);

function classifyHost(host: string): Classification | undefined {
  return HOSTS.get(host);
}

// ---------------------------------------------------------------------------------------------
// Inventory readers.
// ---------------------------------------------------------------------------------------------
const PACKAGE_JSONS = [
  'package.json',
  'apps/web/package.json',
  ...readdirSync(join(ROOT, 'packages')).map((p) => `packages/${p}/package.json`),
  'workers/package.json',
].filter((p) => existsSync(join(ROOT, p)));

function runtimeDependencies(): Map<string, string> {
  const deps = new Map<string, string>();
  for (const file of PACKAGE_JSONS) {
    const pkg = JSON.parse(read(file)) as { dependencies?: Record<string, string> };
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (!name.startsWith('@tims/')) deps.set(name, file);
    }
  }
  return deps;
}

function walk(dir: string, exts: readonly string[], out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'bin' || entry === 'obj') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

const SOURCE_FILES = [
  ...walk(join(ROOT, 'apps/web'), ['.ts', '.tsx']),
  ...readdirSync(join(ROOT, 'packages')).flatMap((p) => walk(join(ROOT, 'packages', p, 'src'), ['.ts', '.tsx'])),
  ...walk(join(ROOT, 'workers/src'), ['.ts']),
  ...walk(join(ROOT, 'services/Tims.Platform/src'), ['.cs']),
];

const INVENTORY_FILE = join('lib', 'legal', 'subprocessors.ts');

/** Runtime source where an activating env var must actually be read: everything except the inventory. */
function activationCorpus(): string {
  return SOURCE_FILES.filter((f) => !f.endsWith(INVENTORY_FILE))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}

function nugetPackages(): Map<string, string> {
  const pkgs = new Map<string, string>();
  for (const file of walk(join(ROOT, 'services'), ['.csproj'])) {
    for (const m of readFileSync(file, 'utf8').matchAll(/PackageReference Include="([^"]+)"/g)) pkgs.set(m[1]!, file);
  }
  return pkgs;
}

function referencedHosts(): Map<string, string> {
  const hosts = new Map<string, string>();
  for (const file of SOURCE_FILES) {
    if (file.endsWith(INVENTORY_FILE)) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(/\b(?:https|wss):\/\/([a-zA-Z0-9*.-]+\.[a-zA-Z]{2,})/g)) {
      hosts.set(m[1]!.toLowerCase(), file);
    }
  }
  return hosts;
}

// Comment-only documentation links are not data flows.
const DOC_HOSTS = new Set(['docs.daily.co', 'nextjs.org', 'github.com', 'www.postgresql.org']);

// Exact placeholder hosts (RFC 2606/6761-style examples). An exact list, never a substring rule: the old
// `includes('domain')` exempted real vendors such as api.domainr.com (tier-1 review).
const PLACEHOLDER_HOSTS = new Set(['example.com']);
const isPlaceholderHost = (h: string) =>
  PLACEHOLDER_HOSTS.has(h) || h.endsWith('.example.com') || h.endsWith('.example') || h.endsWith('.test') || h.endsWith('.invalid');

function unclassified(found: Map<string, string>, classify: (key: string) => Classification | undefined) {
  return [...found]
    .filter(([key]) => classify(key) === undefined)
    .map(([key, file]) => `${key} (${file.replace(`${ROOT}/`, '')})`);
}

function vendorIds(table: Iterable<Classification>): string[] {
  return [...table].filter((c): c is string => typeof c === 'string');
}

// ---------------------------------------------------------------------------------------------

describe('subprocessor list (apps/web/lib/legal/subprocessors.ts)', () => {
  it('has unique ids and complete bilingual text', () => {
    expect(ids.size).toBe(SUBPROCESSORS.length);
    for (const sp of SUBPROCESSORS) {
      for (const field of [sp.purpose, sp.dataCategories]) {
        expect(field.es.trim(), `${sp.id} es`).not.toBe('');
        expect(field.en.trim(), `${sp.id} en`).not.toBe('');
        expect(field.es, `${sp.id}: es and en must differ (untranslated copy)`).not.toBe(field.en);
      }
      expect(sp.evidence.length, `${sp.id} must cite evidence`).toBeGreaterThan(0);
    }
  });

  it.each(SUBPROCESSORS.flatMap((sp) => sp.evidence.map((e) => [sp.id, e.file, e.contains] as const)))(
    '%s: evidence %s still contains %j',
    (_id, file, contains) => {
      expect(existsSync(join(ROOT, file)), `${file} is gone`).toBe(true);
      expect(read(file)).toContain(contains);
    },
  );

  it('every activating env var of a "configured" vendor is read somewhere in source', () => {
    // The inventory itself is excluded: it names every activating variable, so including it would make each
    // declaration satisfy its own check (tier-1 review).
    const corpus = activationCorpus();
    expect(corpus, 'the inventory must not be part of its own evidence').not.toContain('export const SUBPROCESSORS');
    for (const sp of SUBPROCESSORS) {
      if (sp.condition === 'configured')
        expect(sp.activatedBy?.length, `${sp.id} needs activatedBy`).toBeGreaterThan(0);
      for (const name of sp.activatedBy ?? []) expect(corpus, `${sp.id}: ${name}`).toContain(name);
    }
  });

  it('every runtime npm dependency is classified', () => {
    expect(unclassified(runtimeDependencies(), (name) => NPM_DEPENDENCIES[name])).toEqual([]);
  });

  it('every .NET package reference is classified', () => {
    expect(unclassified(nugetPackages(), (name) => NUGET_PACKAGES[name])).toEqual([]);
  });

  it('every https/wss host referenced in source is classified', () => {
    const hosts = referencedHosts();
    for (const doc of DOC_HOSTS) hosts.delete(doc);
    expect(unclassified(hosts, (h) => (isPlaceholderHost(h) ? { notAVendor: 'placeholder' } : classifyHost(h)))).toEqual([]);
  });

  it('a third party on shared hosting is never classified as one of our vendors', () => {
    for (const foreign of [
      'resume-parser.vendor-example.vercel.app',
      'd111111abcdef8.cloudfront.net',
      'vercel.app',
      // AWS and Supabase host other tenants too (tier-1 review): an API Gateway, another account's bucket,
      // another Supabase project.
      'foreign-parser.execute-api.us-east-1.amazonaws.com',
      'other-bucket.s3.us-west-2.amazonaws.com',
      'amazonaws.com',
      'foreign-parser.supabase.co',
      'supabase.co',
      'foreign-recorder.livekit.cloud',
      'another-customer.daily.co',
      'o123456.ingest.sentry.io',
      'evil.elevenlabs.io.attacker.net',
    ]) {
      expect(classifyHost(foreign), foreign).toBeUndefined();
    }
    expect(classifyHost('tims-ats.vercel.app')).toBe('vercel');
    expect(classifyHost('tims-cv.s3.us-west-2.amazonaws.com')).toBe('aws-s3');
    expect(classifyHost('*.supabase.co')).toBe('supabase');
    expect(classifyHost('*.livekit.cloud')).toBe('elevenlabs');
  });

  it('only reserved example hosts count as placeholders, never a real vendor that merely contains a word', () => {
    for (const real of ['api.domainr.com', 'domain.com', 'mydomain.io', 'example.com.evil.net']) {
      expect(isPlaceholderHost(real), real).toBe(false);
    }
    for (const reserved of ['example.com', 'app.example.com', 'tenant.example', 'ats.example.test', 'x.invalid']) {
      expect(isPlaceholderHost(reserved), reserved).toBe(true);
    }
  });

  it('every vendor named by a classification exists in the list, and every listed vendor is detected', () => {
    const named = new Set([
      ...vendorIds(Object.values(NPM_DEPENDENCIES)),
      ...vendorIds(Object.values(NUGET_PACKAGES)),
      ...vendorIds(HOSTS.values()),
    ]);
    expect([...named].filter((id) => !ids.has(id))).toEqual([]);
    // Infrastructure-only vendors are detected through their evidence files instead of an SDK/host.
    const infrastructureOnly = new Set(['aws-app-runner']);
    expect([...ids].filter((id) => !named.has(id) && !infrastructureOnly.has(id))).toEqual([]);
  });
});
