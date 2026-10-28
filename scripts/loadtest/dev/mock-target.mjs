#!/usr/bin/env node
// A local stand-in for the web app + C# relay, so the k6 scripts can be exercised end to end with
// NO real environment, NO database and NO credentials. It answers the exact request shapes the
// scenarios send (HTML pages, tRPC batch GETs, /api/platform GETs) and counts every request by
// method: any non-GET is answered 405 and reported on exit, as a runtime proof the suite is
// read-only.
//
//   node scripts/loadtest/dev/mock-target.mjs            # listens on 127.0.0.1:4310
//   MOCK_FAIL_RATE=0.3 node scripts/loadtest/dev/mock-target.mjs   # inject 500s (thresholds must fail)
//   MOCK_DELAY_MS=900 ...                                 # inject latency (p95 threshold must fail)
//   MOCK_RATE_LIMIT_RATE=0.5 ...                          # inject 429s (rate-limited threshold must fail)
//
// No dependencies: Node built-ins only.

import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 4310);
const FAIL_RATE = Number(process.env.MOCK_FAIL_RATE ?? 0);
const RATE_LIMIT_RATE = Number(process.env.MOCK_RATE_LIMIT_RATE ?? 0);
const DELAY_MS = Number(process.env.MOCK_DELAY_MS ?? 0);
const VACANCY_IDS = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];

const counts = { byMethod: {}, writes: 0 };

const QUERY_DATA = {
  'portal.getPortalStats': () => ({ openPositions: 2 }),
  'portal.listVacancies': () => ({
    items: VACANCY_IDS.map((id) => ({ id, title: 'Synthetic role' })),
    nextCursor: null,
  }),
  'portal.getVacancy': () => ({ id: VACANCY_IDS[0], organizationId: '00000000-0000-4000-8000-0000000000aa' }),
  'candidate.getDashboardKpis': () => ({ total: 0 }),
  'candidate.list': () => ({ items: [], nextCursor: null }),
  'vacancy.list': () => ({ items: VACANCY_IDS.map((id) => ({ id })), nextCursor: null }),
  'pipeline.getBoard': () => ({ stages: [] }),
};

const html = (title) => `<!doctype html><html><head><title>${title}</title></head><body>mock</body></html>`;

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function hasSession(req) {
  return /(?:^|;\s*)sb-[A-Za-z0-9]+-auth-token(?:\.\d+)?=/.test(req.headers.cookie ?? '');
}

const server = createServer((req, res) => {
  counts.byMethod[req.method] = (counts.byMethod[req.method] ?? 0) + 1;
  if (req.method !== 'GET') {
    counts.writes += 1;
    return send(res, 405, { error: 'mock is read-only' });
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  setTimeout(() => {
    if (Math.random() < RATE_LIMIT_RATE) return send(res, 429, { error: 'rate_limited' });
    if (Math.random() < FAIL_RATE) return send(res, 500, { error: 'injected' });

    if (/^\/careers\/[^/]+(\/[^/]+)?$/.test(url.pathname)) return send(res, 200, html('careers'), 'text/html');

    if (url.pathname.startsWith('/recruitment/')) {
      if (!hasSession(req)) {
        res.writeHead(307, { location: '/login' });
        return res.end();
      }
      return send(res, 200, html('staff'), 'text/html');
    }

    if (url.pathname.startsWith('/api/trpc/')) {
      const paths = decodeURIComponent(url.pathname.slice('/api/trpc/'.length)).split(',');
      const out = paths.map((p) => {
        const make = QUERY_DATA[p];
        if (!make) return { error: { json: { message: 'not found', data: { code: 'NOT_FOUND', httpStatus: 404 } } } };
        if (!p.startsWith('portal.') && !hasSession(req)) {
          return { error: { json: { message: 'unauthorized', data: { code: 'UNAUTHORIZED', httpStatus: 401 } } } };
        }
        return { result: { data: { json: make() } } };
      });
      const allOk = out.every((o) => o.result);
      return send(res, allOk ? 200 : 207, out);
    }

    if (url.pathname.startsWith('/api/platform/')) {
      if (!/^Bearer [A-Za-z0-9._~-]+$/.test(req.headers.authorization ?? ''))
        return send(res, 401, { error: 'no bearer' });
      return send(res, 200, { ok: true, path: url.pathname });
    }

    return send(res, 404, { error: 'unknown mock route' });
  }, DELAY_MS);
});

function report() {
  console.error(
    `[mock-target] requests by method: ${JSON.stringify(counts.byMethod)}; write attempts: ${counts.writes}`,
  );
}

process.on('SIGINT', () => {
  report();
  process.exit(counts.writes === 0 ? 0 : 1);
});
process.on('SIGTERM', () => {
  report();
  process.exit(counts.writes === 0 ? 0 : 1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.error(`[mock-target] listening on http://127.0.0.1:${PORT}`);
});
