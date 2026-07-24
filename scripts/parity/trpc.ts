export class TrpcError extends Error {
  constructor(msg: string, readonly code?: number) {
    super(msg);
  }
}

export function stripTrpcJson(body: unknown): unknown {
  const first = Array.isArray(body) ? body[0] : body;
  if (first && typeof first === 'object') {
    const f = first as Record<string, any>;
    if (f.error) throw new TrpcError(f.error?.json?.message ?? 'tRPC error', f.error?.json?.code);
    if (f.result?.data && 'json' in f.result.data) return f.result.data.json;
  }
  throw new TrpcError('Unrecognized tRPC response shape');
}

export function buildTrpcQueryUrl(base: string, procedure: string, input: unknown): string {
  const payload = encodeURIComponent(JSON.stringify({ 0: { json: input } }));
  return `${base}/api/trpc/${procedure}?batch=1&input=${payload}`;
}
