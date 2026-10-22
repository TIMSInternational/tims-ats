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

// Host suffix -> classification. Matched against every https/wss host referenced in source.
const HOSTS: Array<[suffix: string, classification: Classification]> = [
  ['supabase.co', 'supabase'],
  ['daily.co', 'daily'],
  ['dailywebrtc.com', 'daily'],
  ['dailywebrtc.net', 'daily'],
  ['pluot.blue', 'daily'],
  ['elevenlabs.io', 'elevenlabs'],
  // @elevenlabs/client depends on livekit-client: the WebRTC transport of the ElevenLabs session.
  ['livekit.cloud', 'elevenlabs'],
  ['challenges.cloudflare.com', 'cloudflare-turnstile'],
  ['sentry.io', 'sentry'],
  ['amazonaws.com', 'aws-s3'],
  ['api.bamboohr.com', 'bamboohr'],
  ['accounts.google.com', { notAVendor: 'sign-in identity provider chosen by the user (counsel TODO on the page)' }],
  [
    'login.microsoftonline.com',
    { notAVendor: 'sign-in identity provider chosen by the user (counsel TODO on the page)' },
  ],
  ['googleusercontent.com', { notAVendor: 'img-src allowance for identity-provider profile pictures' }],
  ['fonts.googleapis.com', { notAVendor: 'CSP allowance only; next/font self-hosts fonts at build time' }],
  ['fonts.gstatic.com', { notAVendor: 'CSP allowance only; next/font self-hosts fonts at build time' }],
  ['open.er-api.com', { notAVendor: 'public exchange-rate feed; no personal data is sent' }],
  ['api.frankfurter.dev', { notAVendor: 'public exchange-rate feed; no personal data is sent' }],
  ['linkedin.com', { notAVendor: 'input placeholder text only' }],
  ['portal.invalid', { notAVendor: 'reserved .invalid base URL used for URL parsing' }],
  ['storage.tims.app', { notAVendor: 'mock URL string in a stub service' }],
];

// Shared hosting domains: ANYONE can run a service under them, so a suffix rule would classify a third
// party's endpoint (`resume-parser.vendor.vercel.app`) as our own vendor (tier-1 review). Exact hosts only,
// each one reviewed.
const EXACT_HOSTS = new Map<string, Classification>([
  ['tims-ats.vercel.app', 'vercel'],
  // The literal CSP wildcard string, not a host anything is sent to.
  ['*.cloudfront.net', { notAVendor: 'img-src allowance only; the browser fetches images, no data is sent' }],
]);
const SHARED_HOSTING_SUFFIXES = ['vercel.app', 'cloudfront.net'];

function classifyHost(host: string): Classification | undefined {
  const exact = EXACT_HOSTS.get(host);
  if (exact !== undefined) return exact;
  const bare = host.replace(/^\*\./, '');
  if (SHARED_HOSTING_SUFFIXES.some((suffix) => bare === suffix || bare.endsWith(`.${suffix}`))) return undefined;
  return HOSTS.find(([suffix]) => bare === suffix || bare.endsWith(`.${suffix}`))?.[1];
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
    if (file.endsWith(join('lib', 'legal', 'subprocessors.ts'))) continue;
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
    const corpus = SOURCE_FILES.map((f) => readFileSync(f, 'utf8')).join('\n');
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
    for (const foreign of ['resume-parser.vendor-example.vercel.app', 'd111111abcdef8.cloudfront.net', 'vercel.app']) {
      expect(classifyHost(foreign), foreign).toBeUndefined();
    }
    expect(classifyHost('tims-ats.vercel.app')).toBe('vercel');
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
      ...vendorIds(HOSTS.map(([, c]) => c)),
      ...vendorIds(EXACT_HOSTS.values()),
    ]);
    expect([...named].filter((id) => !ids.has(id))).toEqual([]);
    // Infrastructure-only vendors are detected through their evidence files instead of an SDK/host.
    const infrastructureOnly = new Set(['aws-app-runner']);
    expect([...ids].filter((id) => !named.has(id) && !infrastructureOnly.has(id))).toEqual([]);
  });
});
