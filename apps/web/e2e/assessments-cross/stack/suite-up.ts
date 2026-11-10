/**
 * LOCAL-ONLY bring-up of tims-suite for the cross-system e2e (adapted from the suite's own
 * apps/web/e2e/hosted/stack.ts): a disposable PostgreSQL 16 with the suite schema (baseline + every
 * migration in order), PostgREST, the REAL API (with webhooks, cron and draft consent texts on) and
 * the built hosted player over https with /api proxied same-origin. Nothing reaches AWS.
 *
 * Long-running: writes STATE_FILE when ready and tears everything down on SIGTERM/SIGINT.
 * Env: SUITE_DIR, STATE_DIR, TLS_CERT, TLS_KEY, CA_PEM, PREFIX, ATS_ORIGIN, ATS_WEBHOOK_URL, SHIM.
 */
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { createServer as createHttpServer, request as httpRequest, type Server } from 'node:http';
import { join, extname, normalize } from 'node:path';
import { createServer as createHttpsServer } from 'node:https';
import { existsSync, statSync } from 'node:fs';

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};
const SUITE = need('SUITE_DIR');
const STATE = need('STATE_DIR');
const WEB = join(SUITE, 'apps/web');
const API_DIR = join(SUITE, 'apps/api');
const PREFIX = need('PREFIX');
const PORTS = {
  db: 57471,
  rest: 57472,
  supabase: 57473,
  api: 57474,
  player: 57475,
  audio: 57476,
  pcaApi: 57479,
  pcaSurvey: 57480,
};
const DB = `${PREFIX}-db`;
const REST = `${PREFIX}-rest`;
const NET = `${PREFIX}-net`;
const POSTGREST_IMAGE = 'public.ecr.aws/supabase/postgrest:v13.0.4';
const execFileAsync = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function docker(args: string[], opts: { input?: string; allowFail?: boolean } = {}): string {
  try {
    return execFileSync('docker', args, {
      input: opts.input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 << 20,
    });
  } catch (e) {
    if (opts.allowFail) return '';
    const err = e as { stderr?: string; message: string };
    throw new Error(`docker ${args.slice(0, 3).join(' ')} failed: ${err.stderr || err.message}`);
  }
}
export function psql(sql: string, tuples = false): string {
  const args = ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'];
  if (tuples) args.push('-At');
  return docker(args, { input: sql });
}
const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');
function jwt(secret: string, claims: Record<string, unknown>): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}
async function waitFor(what: string, check: () => Promise<boolean> | boolean, timeoutMs = 180_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      /* not yet */
    }
    if (Date.now() > end) throw new Error(`${what} did not come up`);
    await sleep(500);
  }
}
function httpOk(url: string): Promise<boolean> {
  return new Promise((res) => {
    const r = httpRequest(url, { method: 'GET', timeout: 2000 }, (resp) => {
      resp.resume();
      res((resp.statusCode ?? 500) < 500);
    });
    r.on('error', () => res(false));
    r.end();
  });
}
function buildSchema(): number {
  psql(readFileSync(join(WEB, 'e2e/hosted/supabase-standins.sql'), 'utf8'));
  psql(
    readFileSync(join(SUITE, 'database/schema-baseline.sql'), 'utf8').replace(/^SET transaction_timeout = 0;$/m, ''),
  );
  psql(readFileSync(join(SUITE, 'database/011_missing_user_company_columns.sql'), 'utf8'));
  psql(readFileSync(join(SUITE, 'database/012_auth_user_trigger.sql'), 'utf8'));
  let applied = 0;
  for (const f of readdirSync(join(SUITE, 'database/migrations'))
    .filter((x) => x.endsWith('.sql'))
    .sort()) {
    const num = /^(\d+)_/.exec(f)?.[1];
    if (num !== undefined && Number(num) < 28) continue;
    try {
      psql(readFileSync(join(SUITE, 'database/migrations', f), 'utf8'));
    } catch (e) {
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
    applied++;
  }
  return applied;
}
function supabaseProxy(): Server {
  return createHttpServer((req, res) => {
    const url = req.url ?? '/';
    if (!url.startsWith('/rest/v1/')) return void res.writeHead(404).end();
    const up = httpRequest(
      {
        host: '127.0.0.1',
        port: PORTS.rest,
        path: url.slice('/rest/v1'.length),
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${PORTS.rest}` },
      },
      (u) => {
        res.writeHead(u.statusCode ?? 502, u.headers);
        u.pipe(res);
      },
    );
    up.on('error', () => res.writeHead(502).end());
    req.pipe(up);
  }).listen(PORTS.supabase, '127.0.0.1');
}
/**
 * A local stand-in for the TIMS legacy PCA provider (timshr.com), so PCA can be
 * driven through /v1 without a TIMS sandbox key. It holds NO assessment content:
 * the "survey" is one button that marks the sitting complete, and the results
 * are fixed synthetic numbers. API over http (the suite calls it), the survey
 * page over https (the ATS only accepts an https provider URL).
 */
function fakePcaServers(): Server[] {
  const done = new Set<string>();
  let n = 0;
  const surveyBase = `https://localhost:${PORTS.pcaSurvey}`;
  // A JWT-shaped token whose payload names a company and user, as the provider's does.
  const token = `fake.${Buffer.from(JSON.stringify({ unique_name: '1_1' })).toString('base64url')}.sig`;
  const json = (res: import('node:http').ServerResponse, body: unknown) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const api = createHttpServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = (() => { try { return JSON.parse(raw || '{}') as Record<string, unknown>; } catch { return {}; } })();
      const cod = String(body.PcaCod ?? '');
      switch (req.url) {
        case '/login/authenticate':
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          return void res.end(`"${token}"`);
        case '/Pca/AddSurvey': {
          n += 1;
          const code = `LOCAL-${Date.now().toString(36)}-${n}`;
          return json(res, { PcaCod: code, PcaLink: `${surveyBase}/survey?c=${code}` });
        }
        case '/Pca/GetLink':
          return json(res, { PcaEst: done.has(cod) ? '7' : '1', PcaLink: `${surveyBase}/survey?c=${cod}` });
        case '/Pca/GetPcaResult': {
          const d = new Date();
          const fec = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
          return json(res, [{ PcaFec: fec, PcaD1: 62, PcaI1: 48, PcaS1: 35, PcaC1: 55, PcaD2: 70, PcaI2: 40, PcaS2: 30,
            PcaC2: 52, PcaD3: 55, PcaI3: 50, PcaS3: 42, PcaC3: 49 }]);
        }
        case '/Pca/GetCompetencesResult':
          return json(res, { PcaCmps: [{ CmpNom: 'Orientación a resultados', Level: 3 },
            { CmpNom: 'Trabajo en equipo', Level: 4 }, { CmpNom: 'Planificación', Level: 2 }] });
        case '/report':
          res.writeHead(200, { 'Content-Type': 'application/pdf' });
          return void res.end(Buffer.from('%PDF-1.4\n% local stand-in report\n%%EOF\n'));
        default:
          res.writeHead(404).end();
      }
    });
  }).listen(PORTS.pcaApi, '127.0.0.1');
  const page = (title: string, body: string) =>
    `<!doctype html><html lang="es"><meta charset="utf-8"><title>${title}</title>` +
    `<body style="font-family:system-ui;max-width:36rem;margin:4rem auto;line-height:1.5">${body}</body></html>`;
  const survey = createHttpsServer({ cert: readFileSync(need('TLS_CERT')), key: readFileSync(need('TLS_KEY')) }, (req, res) => {
    const u = new URL(req.url ?? '/', surveyBase);
    const code = (u.searchParams.get('c') ?? '').replace(/[^A-Za-z0-9-]/g, '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (u.pathname === '/survey' && req.method === 'GET' && code) {
      return void res.end(page('PCA (simulado)', `<h1>PCA — proveedor simulado</h1>
        <p>Esta página reemplaza localmente el sitio de TIMS donde la persona responde el PCA.</p>
        <p>Código de la evaluación: <code>${code}</code></p>
        <form method="post" action="/survey/complete?c=${code}"><button type="submit">Completar el PCA</button></form>`));
    }
    if (u.pathname === '/survey/complete' && req.method === 'POST' && code) {
      done.add(code);
      return void res.end(page('PCA completado', `<h1>PCA completado</h1>
        <p>Listo. Puede cerrar esta pestaña y volver al portal. El resultado llega a la empresa en la próxima revisión programada.</p>`));
    }
    res.writeHead(404).end();
  }).listen(PORTS.pcaSurvey, 'localhost');
  return [api, survey];
}

/** The public English listening clips (what FRONTEND_URL serves in production), over https. */
function audioServer(): Server {
  const root = join(WEB, 'public');
  const MIME: Record<string, string> = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
  return createHttpsServer({ cert: readFileSync(need('TLS_CERT')), key: readFileSync(need('TLS_KEY')) }, (req, res) => {
    const u = new URL(req.url ?? '/', 'https://localhost');
    const file = normalize(join(root, decodeURIComponent(u.pathname)));
    if (u.pathname.startsWith('/audio/') && file.startsWith(root) && existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      });
      return void res.end(readFileSync(file));
    }
    res.writeHead(404).end();
  }).listen(PORTS.audio, 'localhost');
}
function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'SHELL', 'USER']) if (process.env[k]) env[k] = process.env[k];
  return env;
}

const procs: ChildProcess[] = [];
const servers: Server[] = [];
async function down() {
  for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM');
  await sleep(1500);
  for (const p of procs) if (p.exitCode === null) p.kill('SIGKILL');
  for (const s of servers) s.close();
  docker(['rm', '-f', REST, DB], { allowFail: true });
  docker(['network', 'rm', NET], { allowFail: true });
}

async function main() {
  mkdirSync(STATE, { recursive: true });
  docker(['rm', '-f', REST, DB], { allowFail: true });
  docker(['network', 'rm', NET], { allowFail: true });
  docker(['network', 'create', NET]);
  docker([
    'run',
    '-d',
    '--name',
    DB,
    '--network',
    NET,
    '-e',
    `POSTGRES_PASSWORD=${randomBytes(12).toString('hex')}`,
    '-p',
    `127.0.0.1:${PORTS.db}:5432`,
    'postgres:16',
  ]);
  await waitFor('postgres', () =>
    docker(['exec', DB, 'pg_isready', '-U', 'postgres'], {
      allowFail: true,
    }).includes('accepting'),
  );
  await waitFor('postgres sql', () => psql('SELECT 1', true).trim() === '1');
  const appliedMigrations = buildSchema();

  const jwtSecret = randomBytes(32).toString('hex');
  docker([
    'run',
    '-d',
    '--name',
    REST,
    '--network',
    NET,
    '-p',
    `127.0.0.1:${PORTS.rest}:3000`,
    '-e',
    `PGRST_DB_URI=postgres://authenticator:authenticator@${DB}:5432/postgres`,
    '-e',
    'PGRST_DB_SCHEMAS=public',
    '-e',
    'PGRST_DB_ANON_ROLE=anon',
    '-e',
    `PGRST_JWT_SECRET=${jwtSecret}`,
    '-e',
    'PGRST_DB_POOL=20',
    POSTGREST_IMAGE,
  ]);
  await waitFor('postgrest', () => httpOk(`http://127.0.0.1:${PORTS.rest}/`));
  servers.push(supabaseProxy());
  const supabaseUrl = `http://127.0.0.1:${PORTS.supabase}`;
  const serviceKey = jwt(jwtSecret, {
    role: 'service_role',
    iss: 'assessments-cross',
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
  });

  await execFileAsync(join(API_DIR, 'node_modules/.bin/tsx'), ['scripts/seed-lia-questions.ts'], {
    cwd: API_DIR,
    env: {
      ...baseEnv(),
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    },
  });

  const playerOrigin = `https://localhost:${PORTS.player}`;
  servers.push(audioServer());
  servers.push(...fakePcaServers());
  const cronSecret = randomBytes(24).toString('hex');
  execFileSync(join(WEB, 'node_modules/.bin/vite'), ['build', '-c', 'vite.hosted.config.ts', '--logLevel', 'warn'], {
    cwd: WEB,
    stdio: 'pipe',
  });
  const apiLog = createWriteStream(join(STATE, 'suite-api.log'));
  const api = spawn(join(API_DIR, 'node_modules/.bin/tsx'), ['--require', need('SHIM'), 'src/index.ts'], {
    cwd: API_DIR,
    env: {
      ...baseEnv(),
      NODE_ENV: 'development',
      PORT: String(PORTS.api),
      SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      FRONTEND_URL: playerOrigin,
      RATE_LIMIT_MAX: '1000000',
      V1_PARTNER_API_ENABLED: 'true',
      V1_TOKEN_SIGNING_SECRET: randomBytes(32).toString('hex'),
      V1_PUBLIC_BASE_URL: `${playerOrigin}/api`,
      V1_HOSTED_PLAYER_URL: playerOrigin,
      // Production consent mode: only the approved texts are served and recorded.
      V1_ALLOW_DRAFT_CONSENT_TEXTS: 'false',
      V1_ENGLISH_LISTENING_PUBLIC_FALLBACK: 'true',
      V1_WEBHOOK_SECRET_KEY: randomBytes(32).toString('base64'),
      CRON_SECRET: cronSecret,
      // PCA through /v1 against the local stand-in provider above (no TIMS key).
      PCA_COKEY: 'local-stand-in',
      PCA_BASE_URL: `http://127.0.0.1:${PORTS.pcaApi}`,
      PCA_REPORT_URL: `http://127.0.0.1:${PORTS.pcaApi}/report`,
      ENGLISH_AUDIO_BASE_URL: `https://localhost:${PORTS.audio}/audio/english/listening`,
      NODE_EXTRA_CA_CERTS: need('CA_PEM'),
      AWS_ENDPOINT_URL: 'http://127.0.0.1:9',
      AWS_ACCESS_KEY_ID: 'e2e-not-a-key',
      AWS_SECRET_ACCESS_KEY: 'e2e-not-a-secret',
      AWS_REGION: 'us-east-1',
      AWS_EC2_METADATA_DISABLED: 'true',
      AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
      AWS_CONFIG_FILE: '/dev/null',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  procs.push(api);
  api.stdout?.pipe(apiLog);
  api.stderr?.pipe(apiLog);
  await waitFor('the suite API', () => httpOk(`http://127.0.0.1:${PORTS.api}/health`));

  const preview = spawn(
    join(WEB, 'node_modules/.bin/vite'),
    ['preview', '-c', 'vite.hosted.config.ts', '--port', String(PORTS.player), '--strictPort', '--host', 'localhost'],
    {
      cwd: WEB,
      env: {
        ...baseEnv(),
        HOSTED_E2E_API_URL: `http://127.0.0.1:${PORTS.api}`,
        HOSTED_E2E_TLS_CERT: need('TLS_CERT'),
        HOSTED_E2E_TLS_KEY: need('TLS_KEY'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  procs.push(preview);
  const pvLog = createWriteStream(join(STATE, 'suite-player.log'));
  preview.stdout?.pipe(pvLog);
  preview.stderr?.pipe(pvLog);
  await waitFor('the player origin', () => {
    const code = execFileSync(
      'curl',
      [
        '-s',
        '--cacert',
        need('CA_PEM'),
        '-o',
        '/dev/null',
        '-w',
        '%{http_code}',
        `${playerOrigin}/hosted-player/player.js`,
      ],
      { encoding: 'utf8' },
    );
    return code === '200';
  });

  writeFileSync(
    join(STATE, 'suite.json'),
    JSON.stringify(
      {
        dbContainer: DB,
        supabaseUrl,
        serviceKey,
        apiUrl: `http://127.0.0.1:${PORTS.api}`,
        playerOrigin,
        cronSecret,
        appliedMigrations,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`suite up: ${playerOrigin} (${appliedMigrations} migrations)`);
}

process.on('SIGTERM', () => void down().then(() => process.exit(0)));
process.on('SIGINT', () => void down().then(() => process.exit(0)));
main().catch(async (e) => {
  console.error(e);
  await down();
  process.exit(1);
});
setInterval(() => {}, 1 << 30);
