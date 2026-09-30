// E2E-only server for apps/web: the production build (`next build` output, dev: false) served over
// HTTPS on the public E2E origin, with Supabase's /auth/v1 and /rest/v1 proxied SAME-ORIGIN.
//
// Why not `next start` behind a TLS proxy: the web app derives a request's own origin from the port
// and scheme it is listening on, and /api/platform (lib/platform-api/proxy.ts) rejects any browser
// request whose Origin differs from that — so Next must itself listen on https://localhost:<port>,
// exactly the origin the browser uses.
//
// Why Supabase is proxied here: the production CSP only allows the browser to connect to
// https://*.supabase.co. Serving the local Supabase from the app's own origin ('self') keeps the
// real CSP fully enforced without patching the app.
//
// Run from apps/web (so `next` resolves from its node_modules):
//   node ../../scripts/e2e/web-server.mjs
// Env: E2E_WEB_TLS_PORT, E2E_TLS_CERT, E2E_TLS_KEY, E2E_SUPABASE_UPSTREAM (http://127.0.0.1:<port>).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(process.cwd(), 'package.json'));
const next = require('next');

const port = Number(process.env.E2E_WEB_TLS_PORT);
const upstream = new URL(process.env.E2E_SUPABASE_UPSTREAM ?? '');
if (!port || !['127.0.0.1', 'localhost'].includes(upstream.hostname)) {
  console.error('[e2e web] E2E_WEB_TLS_PORT and a LOCAL E2E_SUPABASE_UPSTREAM are required');
  process.exit(2);
}

// Final net before Next reads apps/web/.env*: refuse to start if any key would come from a .env file
// (a developer's apps/web/.env.local is a symlink to the LIVE root .env) or any effective URL is
// non-local. Run in a child process so @next/env's module-level cache in THIS process stays untouched.
try {
  execFileSync(process.execPath, [fileURLToPath(new URL('./env-guard.mjs', import.meta.url))], {
    stdio: 'inherit',
  });
} catch {
  console.error('[e2e web] env isolation guard failed — refusing to start');
  process.exit(3);
}

const app = next({ dev: false, hostname: 'localhost', port });
const handle = app.getRequestHandler();
await app.prepare();

const SUPABASE_PATHS = /^\/(auth|rest)\/v1\//;

function proxyToSupabase(req, res) {
  const forward = httpRequest(
    {
      host: upstream.hostname,
      port: upstream.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: upstream.host },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  forward.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(forward);
}

createServer(
  { cert: readFileSync(process.env.E2E_TLS_CERT), key: readFileSync(process.env.E2E_TLS_KEY) },
  (req, res) => (SUPABASE_PATHS.test(req.url ?? '') ? proxyToSupabase(req, res) : handle(req, res)),
).listen(port, '127.0.0.1', () => console.log(`[e2e web] https://localhost:${port} ready`));
