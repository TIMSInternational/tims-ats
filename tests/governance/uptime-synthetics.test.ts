import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import Module, { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

// External uptime checks (launch readiness): CloudWatch Synthetics canaries in
// services/Tims.Platform/deploy/terraform/synthetics.tf probe the public careers page and the C# /health
// and /ready endpoints every 5 minutes, alarming to the platform alarms SNS topic. The module is never
// planned in CI (no credentials), so these tests pin the properties a reviewer would otherwise have to
// re-derive by reading HCL: opt-in, the three targets, the schedule, a pinned runtime, the bucket
// hardening, the role's scoping, the alarm routing, and that no hostname is committed.

const ROOT = resolve(__dirname, '../..');
const TF_DIR = join(ROOT, 'services/Tims.Platform/deploy/terraform');
const SYN = readFileSync(join(TF_DIR, 'synthetics.tf'), 'utf8');
const ALARMS_TF = readFileSync(join(TF_DIR, 'alarms.tf'), 'utf8');
const VARS = readFileSync(join(TF_DIR, 'variables.tf'), 'utf8');
const VERSIONS = readFileSync(join(TF_DIR, 'versions.tf'), 'utf8');
const GITIGNORE = readFileSync(join(TF_DIR, '.gitignore'), 'utf8');
const SCRIPT_PATH = join(TF_DIR, 'canary/uptime.js');

/** The body of `resource "<type>" "<name>" { ... }` (or data), by brace matching. */
function block(src: string, header: string): string {
  const start = src.indexOf(header);
  expect(start, `missing block: ${header}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced block: ${header}`);
}

function variableDefault(name: string): string | undefined {
  return block(VARS, `variable "${name}" {`)
    .match(/^\s{2}default\s*=\s*(.+)$/m)?.[1]
    ?.trim();
}

describe('synthetics.tf — uptime canaries', () => {
  it('is opt-in: every resource is gated on enable_synthetics, which defaults to false', () => {
    expect(variableDefault('enable_synthetics')).toBe('false');
    expect(SYN).toMatch(/synthetics_enabled\s*=\s*var\.enable_synthetics/);
    const headers = [...SYN.matchAll(/^(resource|data) "([a-z0-9_]+)" "([a-z0-9_]+)" \{\n\s+(\S+)/gm)];
    expect(headers.length).toBeGreaterThanOrEqual(15);
    for (const [, kind, type, name, firstToken] of headers) {
      const body = block(SYN, `${kind} "${type}" "${name}" {`);
      expect(body, `${type}.${name} must be gated`).toMatch(
        /^\s+(count\s*=\s*local\.synthetics_enabled \? 1 : 0|for_each\s*=\s*local\.synthetics_enabled \?)/m,
      );
      expect(['count', 'for_each']).toContain(firstToken);
    }
  });

  it('declares exactly the three targets: careers page, /health and /ready', () => {
    const canaries = block(SYN, 'synthetics_canaries = {');
    expect([...canaries.matchAll(/^\s{4}([a-z]+) = \{/gm)].map((m) => m[1]).sort()).toEqual(['health', 'ready', 'web']);
    expect(canaries).toMatch(/url\s*=\s*var\.synthetics_web_url/);
    expect(canaries).toContain('trimsuffix(var.synthetics_api_base_url, "/")}/health"');
    expect(canaries).toContain('trimsuffix(var.synthetics_api_base_url, "/")}/ready"');
  });

  it('runs every 5 minutes on an exactly pinned runtime that supports the @aws/* module names', () => {
    const canary = block(SYN, 'resource "aws_synthetics_canary" "uptime" {');
    expect(canary).toContain('expression = "rate(5 minutes)"');
    expect(canary).toMatch(/runtime_version\s*=\s*local\.synthetics_runtime_version/);
    const runtime = SYN.match(/synthetics_runtime_version = "syn-nodejs-puppeteer-(\d+)\.(\d+)"/);
    expect(runtime, 'runtime must be pinned to an exact syn-nodejs-puppeteer-X.Y').not.toBeNull();
    const [major, minor] = [Number(runtime![1]), Number(runtime![2])];
    // @aws/synthetics-puppeteer exists from 13.1 on; an older pin would fail every run at require().
    expect(major > 13 || (major === 13 && minor >= 1)).toBe(true);
    expect(canary).toContain('handler              = "uptime.handler"');
    expect(SYN).toContain('filename = "nodejs/node_modules/uptime.js"');
    // A code change must change zip_file, or the provider never redeploys the canary.
    expect(SYN).toMatch(/output_path = ".*\$\{filemd5\("\$\{path\.module\}\/canary\/uptime\.js"\)\}\.zip"/);
    expect(VERSIONS).toMatch(/archive = \{\s*source\s*=\s*"hashicorp\/archive"\s*version\s*=\s*"\d+\.\d+\.\d+"/);
  });

  it('hardens the artifacts bucket: SSE, all four Block Public Access flags, TLS-only, short expiry', () => {
    expect(
      block(SYN, 'resource "aws_s3_bucket_server_side_encryption_configuration" "synthetics_artifacts" {'),
    ).toMatch(/sse_algorithm = "(AES256|aws:kms)"/);
    const pab = block(SYN, 'resource "aws_s3_bucket_public_access_block" "synthetics_artifacts" {');
    for (const flag of ['block_public_acls', 'block_public_policy', 'ignore_public_acls', 'restrict_public_buckets'])
      expect(pab).toMatch(new RegExp(`${flag}\\s*=\\s*true`));
    expect(block(SYN, 'resource "aws_s3_bucket_ownership_controls" "synthetics_artifacts" {')).toContain(
      '"BucketOwnerEnforced"',
    );
    const policy = block(SYN, 'data "aws_iam_policy_document" "synthetics_artifacts_bucket" {');
    expect(policy).toContain('"aws:SecureTransport"');
    expect(policy).toContain('effect  = "Deny"');
    expect(block(SYN, 'resource "aws_s3_bucket_lifecycle_configuration" "synthetics_artifacts" {')).toMatch(
      /expiration \{\s*days = var\.synthetics_artifact_retention_days/,
    );
    const days = Number(variableDefault('synthetics_artifact_retention_days'));
    expect(days).toBeGreaterThanOrEqual(1);
    expect(days).toBeLessThanOrEqual(30);
    expect(block(SYN, 'resource "aws_synthetics_canary" "uptime" {')).toContain('encryption_mode = "SSE_S3"');
  });

  it('scopes the canary role: no wildcard actions, object writes to the prefix, metrics to one namespace', () => {
    const doc = block(SYN, 'data "aws_iam_policy_document" "synthetics_canary" {');
    const actions = [...doc.matchAll(/actions\s*=\s*\[([^\]]*)\]/g)].flatMap((m) =>
      [...m[1].matchAll(/"([^"]+)"/g)].map((a) => a[1]),
    );
    expect(actions.sort()).toEqual(
      [
        'cloudwatch:PutMetricData',
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        's3:GetBucketLocation',
        's3:ListAllMyBuckets',
        's3:PutObject',
      ].sort(),
    );
    expect(actions.some((a) => a.includes('*'))).toBe(false);
    const statements = doc.split(/\n\s{2}statement \{/).slice(1);
    const wildcard = statements.filter((s) => /resources\s*=\s*\["\*"\]/.test(s));
    // Only the two actions AWS cannot scope below "*" — and PutMetricData only under a namespace condition.
    expect(wildcard).toHaveLength(2);
    expect(wildcard.find((s) => s.includes('s3:ListAllMyBuckets'))).toBeDefined();
    const metrics = wildcard.find((s) => s.includes('cloudwatch:PutMetricData'))!;
    expect(metrics).toContain('"cloudwatch:namespace"');
    expect(metrics).toContain('"CloudWatchSynthetics"');
    expect(statements.find((s) => s.includes('"s3:PutObject"'))).toMatch(
      /synthetics_artifacts\[0\]\.arn\}\/\$\{local\.synthetics_artifacts_prefix\}\/\*"/,
    );
    expect(statements.find((s) => s.includes('logs:PutLogEvents'))).toContain(
      'log-group:/aws/lambda/cwsyn-${var.synthetics_name_prefix}-*',
    );
    expect(block(SYN, 'data "aws_iam_policy_document" "synthetics_assume" {')).toContain('"lambda.amazonaws.com"');
  });

  it('alarms on each canary and routes to the platform alarms topic the way alarms.tf does', () => {
    const alarm = block(SYN, 'resource "aws_cloudwatch_metric_alarm" "synthetics" {');
    expect(alarm).toMatch(/for_each\s*=\s*local\.synthetics_enabled \? local\.synthetics_canaries : \{\}/);
    expect(alarm).toContain('namespace           = "CloudWatchSynthetics"');
    expect(alarm).toContain('metric_name         = "SuccessPercent"');
    expect(alarm).toContain('CanaryName = aws_synthetics_canary.uptime[each.key].name');
    expect(alarm).toContain('treat_missing_data  = "breaching"');
    expect(alarm).toContain('alarm_actions       = [local.synthetics_alarm_topic_arn]');
    expect(alarm).toContain('ok_actions          = [local.synthetics_alarm_topic_arn]');
    // Default topic = the one alarms.tf publishes to; the override exists for the out-of-band live topic.
    expect(SYN).toMatch(
      /synthetics_alarm_topic_arn = \(\s*var\.synthetics_alarm_topic_arn != ""\s*\? var\.synthetics_alarm_topic_arn\s*: one\(aws_sns_topic\.alarms\[\*\]\.arn\)\s*\)/,
    );
    expect(alarm).toContain('condition     = local.synthetics_alarm_topic_arn != null');
  });

  it('every managed resource is in the dependency closure of the alarms, so the owner -target apply creates all of them', () => {
    // The owner apply is `-target=aws_cloudwatch_metric_alarm.synthetics`. -target pulls in only the target
    // and what it (transitively) depends on — never resources that merely depend on something it uses. A
    // resource outside this closure (e.g. the bucket lifecycle, which nothing references) would be silently
    // skipped, and the artifacts would never expire.
    const headers = [...SYN.matchAll(/^(resource|data) "([a-z0-9_]+)" "([a-z0-9_]+)" \{/gm)];
    const bodies = new Map<string, string>();
    for (const [, kind, type, name] of headers) {
      const addr = kind === 'data' ? `data.${type}.${name}` : `${type}.${name}`;
      bodies.set(addr, block(SYN, `${kind} "${type}" "${name}" {`));
    }
    const refs = (body: string) =>
      [...bodies.keys()].filter((addr) => new RegExp(`(^|[^a-z0-9_.])${addr.replace(/\./g, '\\.')}\\b`).test(body));
    const closure = new Set<string>();
    const queue = ['aws_cloudwatch_metric_alarm.synthetics'];
    while (queue.length) {
      const addr = queue.pop()!;
      if (closure.has(addr)) continue;
      closure.add(addr);
      queue.push(...refs(bodies.get(addr)!));
    }
    const managed = [...bodies.keys()].filter((a) => !a.startsWith('data.'));
    expect(managed.length).toBe(10);
    expect(managed.filter((a) => !closure.has(a))).toEqual([]);
  });

  it('the targeted apply on the alarms also creates the email subscription, not just the topic (tier-1 review)', () => {
    // Same closure walk, across synthetics.tf AND alarms.tf. The topic was always in it (alarm_actions);
    // the subscription is referenced by nothing, so -target skipped it and the alarms paged no one.
    const all = SYN + '\n' + ALARMS_TF;
    const headers = [...all.matchAll(/^(resource|data) "([a-z0-9_]+)" "([a-z0-9_]+)" \{/gm)];
    const bodies = new Map<string, string>();
    for (const [, kind, type, name] of headers) {
      const addr = kind === 'data' ? `data.${type}.${name}` : `${type}.${name}`;
      bodies.set(addr, block(all, `${kind} "${type}" "${name}" {`));
    }
    // Locals are resolved too: the alarm reaches the topic through local.synthetics_alarm_topic_arn.
    const locals = block(SYN, 'locals {');
    const refs = (body: string) =>
      [...bodies.keys()].filter((addr) =>
        new RegExp(`(^|[^a-z0-9_.])${addr.replace(/\./g, '\\.')}\\b`).test(body.includes('local.') ? body + locals : body),
      );
    const closure = new Set<string>();
    const queue = ['aws_cloudwatch_metric_alarm.synthetics'];
    while (queue.length) {
      const addr = queue.pop()!;
      if (closure.has(addr)) continue;
      closure.add(addr);
      queue.push(...refs(bodies.get(addr)!));
    }
    expect(closure.has('aws_sns_topic.alarms')).toBe(true);
    expect(closure.has('aws_sns_topic_subscription.alarm_email')).toBe(true);
  });

  it('refuses the topic override together with enable_alarms, so the override path never creates a subscription', () => {
    const alarm = SYN.slice(SYN.indexOf('resource "aws_cloudwatch_metric_alarm" "synthetics"'));
    expect(alarm).toMatch(/condition\s*=\s*!\(var\.synthetics_alarm_topic_arn != "" && var\.enable_alarms\)/);
  });

  it('commits no hostname: the URL variables default to empty and the apply refuses empty/non-https', () => {
    expect(variableDefault('synthetics_web_url')).toBe('""');
    expect(variableDefault('synthetics_api_base_url')).toBe('""');
    expect(variableDefault('synthetics_alarm_topic_arn')).toBe('""');
    expect(block(SYN, 'resource "aws_synthetics_canary" "uptime" {')).toContain(
      'condition     = can(regex("^https://[^/\\\\s]+", each.value.url))',
    );
    for (const src of [SYN, readFileSync(SCRIPT_PATH, 'utf8')]) {
      expect(src).not.toMatch(/https?:\/\/[a-z0-9-]+\.[a-z0-9.-]+/i);
      expect(src).not.toMatch(/awsapprunner\.com|vercel\.app|\b\d{12}\b/);
    }
    expect(GITIGNORE).toMatch(/^\*\.tfvars$/m);
    expect(GITIGNORE).toMatch(/^\*\.tfstate$/m);
    expect(GITIGNORE).toMatch(/^\.build\/$/m);
  });
});

// --- The canary script's own behaviour, with the Synthetics runtime modules stubbed -------------------

type Step = { name: string; options: Record<string, unknown>; config: Record<string, unknown> };
type ModuleWithLoad = typeof Module & { _load: (request: string, ...rest: unknown[]) => unknown };

const originalLoad = (Module as ModuleWithLoad)._load;
afterEach(() => {
  (Module as ModuleWithLoad)._load = originalLoad;
});

function loadCanary(status: number) {
  const steps: Step[] = [];
  const synthetics = {
    getCanaryUserAgentString: () => 'CloudWatchSynthetics/test',
    async executeHttpStep(
      name: string,
      options: Record<string, unknown>,
      validate: (res: EventEmitter & { statusCode: number }) => Promise<void>,
      config: Record<string, unknown>,
    ) {
      steps.push({ name, options, config });
      const res = Object.assign(new EventEmitter(), { statusCode: status });
      const done = validate(res);
      res.emit('data', Buffer.from('ignored'));
      res.emit('end');
      await done;
    },
  };
  const stubs: Record<string, unknown> = {
    '@aws/synthetics-puppeteer': synthetics,
    '@aws/synthetics-logger': { info: () => {} },
  };
  (Module as ModuleWithLoad)._load = function (request: string, ...rest: unknown[]) {
    return request in stubs ? stubs[request] : originalLoad.call(this, request, ...rest);
  };
  const req = createRequire(SCRIPT_PATH);
  delete req.cache[SCRIPT_PATH];
  const mod = req(SCRIPT_PATH) as { handler: () => Promise<void> };
  return { handler: mod.handler, steps };
}

async function runWith(env: Record<string, string | undefined>, status: number) {
  const saved = { TARGET_URL: process.env.TARGET_URL, STEP_NAME: process.env.STEP_NAME };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  try {
    const { handler, steps } = loadCanary(status);
    const outcome = await handler().then(
      () => 'ok' as const,
      (e: Error) => e.message,
    );
    return { outcome, steps };
  } finally {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  }
}

describe('canary/uptime.js', () => {
  it('passes on 2xx and sends one GET to the target path with bodies and headers not captured', async () => {
    const { outcome, steps } = await runWith(
      { TARGET_URL: 'https://example.test/careers/acme?x=1', STEP_NAME: 'web' },
      200,
    );
    expect(outcome).toBe('ok');
    expect(steps).toHaveLength(1);
    expect(steps[0].name).toBe('web');
    expect(steps[0].options).toMatchObject({
      hostname: 'example.test',
      method: 'GET',
      path: '/careers/acme?x=1',
      port: 443,
      protocol: 'https:',
    });
    expect(steps[0].config).toMatchObject({
      includeRequestHeaders: false,
      includeResponseHeaders: false,
      includeRequestBody: false,
      includeResponseBody: false,
    });
  });

  it('fails the run on 503 (an unready /ready) and on a redirect', async () => {
    for (const status of [503, 500, 302, 404]) {
      const { outcome } = await runWith({ TARGET_URL: 'https://example.test/ready' }, status);
      expect(outcome).toBe(`unexpected HTTP status ${status}`);
    }
  });

  it('refuses a missing or non-https TARGET_URL without making a request', async () => {
    const missing = await runWith({ TARGET_URL: undefined }, 200);
    expect(missing.outcome).toBe('TARGET_URL is not set');
    expect(missing.steps).toEqual([]);
    const plain = await runWith({ TARGET_URL: 'http://example.test/health' }, 200);
    expect(plain.outcome).toBe('TARGET_URL must be https');
    expect(plain.steps).toEqual([]);
  });
});
