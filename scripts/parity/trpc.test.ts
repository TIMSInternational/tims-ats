import { describe, it, expect } from 'vitest';
import { stripTrpcJson, buildTrpcQueryUrl, TrpcError } from './trpc';

describe('stripTrpcJson', () => {
  it('unwraps the batch/superjson envelope', () => {
    const body = [{ result: { data: { json: { kpis: { headcount: 5 } } } } }];
    expect(stripTrpcJson(body)).toEqual({ kpis: { headcount: 5 } });
  });
  it('throws TrpcError on an error envelope', () => {
    const body = [{ error: { json: { message: 'FORBIDDEN', code: -32003 } } }];
    expect(() => stripTrpcJson(body)).toThrow(TrpcError);
  });
});

describe('buildTrpcQueryUrl', () => {
  it('encodes batch + input', () => {
    const u = buildTrpcQueryUrl('https://t', 'teamIntel.getDashboardKpis', { teamId: null });
    expect(u).toContain('/api/trpc/teamIntel.getDashboardKpis?batch=1');
    expect(decodeURIComponent(u)).toContain('"json":{"teamId":null}');
  });
});
