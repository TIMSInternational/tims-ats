import { describe, it, expect, vi } from 'vitest';
import { callCsharp, callTs } from './callers';
import { TrpcError } from './trpc';

describe('callCsharp', () => {
  it('GETs base+path with Bearer and returns {status, body}', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const res = await callCsharp('https://c', '/team-intel/dashboard-kpis', 'TOK', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://c/team-intel/dashboard-kpis',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer TOK' }) })
    );
    expect(res).toEqual({ status: 200, body: { ok: 1 } });
  });

  it('returns a null body for an empty response', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 200 }));
    const res = await callCsharp('https://c', '/some/path', 'TOK', fetchFn);
    expect(res).toEqual({ status: 200, body: null });
  });

  it('returns {status, body: rawText} for a non-JSON body (e.g. an HTML error page) instead of throwing', async () => {
    const html = '<html><body>500 Internal Server Error</body></html>';
    const fetchFn = vi.fn(async () => new Response(html, { status: 500 }));
    const res = await callCsharp('https://c', '/team-intel/dashboard-kpis', 'TOK', fetchFn);
    expect(res).toEqual({ status: 500, body: html });
  });
});

describe('callTs', () => {
  it('GETs the built tRPC query URL with Bearer auth and unwraps via stripTrpcJson', async () => {
    const body = [{ result: { data: { json: { kpis: { headcount: 5 } } } } }];
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }));
    const res = await callTs('https://t', 'teamIntel.getDashboardKpis', { teamId: null }, 'TOK', fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchFn.mock.calls[0];
    const calledUrlStr = calledUrl as string;
    expect(calledUrlStr).toContain('/api/trpc/teamIntel.getDashboardKpis?batch=1');
    expect(decodeURIComponent(calledUrlStr)).toContain('"json":{"teamId":null}');
    expect(calledInit?.headers).toMatchObject({ Authorization: 'Bearer TOK' });

    expect(res).toEqual({ kpis: { headcount: 5 } });
  });

  it('throws TrpcError when the tRPC response is an error envelope', async () => {
    const body = [{ error: { json: { message: 'FORBIDDEN', code: -32003 } } }];
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    await expect(callTs('https://t', 'teamIntel.getDashboardKpis', {}, 'TOK', fetchFn)).rejects.toThrow(
      TrpcError
    );
  });
});
