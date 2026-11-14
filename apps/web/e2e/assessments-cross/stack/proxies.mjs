// Local-only helper processes for the cross-system e2e stack:
//  - :AUTH_PROXY  http  /auth/v1/* -> GoTrue (strips the prefix, as Supabase's gateway does)
//  - :OIDC        http  OIDC discovery for the C# API (issuer as GoTrue signs it, jwks reachable from Docker)
//  - :API_TLS     https -> the C# API container (TLS with the throwaway CA's leaf)
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k}`);
  return v;
};
const AUTH_PROXY = Number(env('X_AUTH_PROXY_PORT'));
const GOTRUE = Number(env('X_GOTRUE_PORT'));
const OIDC = Number(env('X_OIDC_PORT'));
const API_TLS = Number(env('X_API_TLS_PORT'));
const API = Number(env('X_API_PORT'));
const ISSUER = env('X_ISSUER');
const tls = { cert: readFileSync(env('X_TLS_CERT')), key: readFileSync(env('X_TLS_KEY')) };

function forward(req, res, port, path) {
  const up = httpRequest(
    { host: '127.0.0.1', port, method: req.method, path, headers: { ...req.headers, host: `127.0.0.1:${port}` } },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    },
  );
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(up);
}

createServer((req, res) => {
  const url = req.url ?? '/';
  if (!url.startsWith('/auth/v1/')) return res.writeHead(404).end();
  forward(req, res, GOTRUE, url.slice('/auth/v1'.length));
}).listen(AUTH_PROXY, '127.0.0.1');

createServer((req, res) => {
  if (req.url !== '/.well-known/openid-configuration') return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      issuer: ISSUER,
      jwks_uri: env('X_JWKS_URI'),
      id_token_signing_alg_values_supported: ['ES256'],
    }),
  );
}).listen(OIDC, '127.0.0.1');

createHttpsServer(tls, (req, res) => forward(req, res, API, req.url ?? '/')).listen(API_TLS, '127.0.0.1');

console.log(`proxies up: auth :${AUTH_PROXY} oidc :${OIDC} api-tls :${API_TLS}`);
