export interface NormalizeOpts {
  dropNullish?: boolean;
  sortArraysBy?: string;
}

export interface DiffEntry {
  path: string;
  a: unknown;
  b: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function normalize(value: unknown, opts: NormalizeOpts = {}): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    const arr = value.map((v) => normalize(v, opts));
    if (opts.sortArraysBy) {
      const k = opts.sortArraysBy;
      arr.sort((x, y) => {
        const xs = JSON.stringify(isObj(x) ? x[k] : x);
        const ys = JSON.stringify(isObj(y) ? y[k] : y);
        return xs === ys ? 0 : xs < ys ? -1 : 1;
      });
    }
    return arr;
  }
  if (isObj(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (opts.dropNullish && (v === null || v === undefined)) continue;
      out[k] = normalize(v, opts);
    }
    return out;
  }
  return value;
}

export function diff(a: unknown, b: unknown, path = ''): DiffEntry[] {
  if (a instanceof Date || b instanceof Date) {
    const av = a instanceof Date ? a.getTime() : a;
    const bv = b instanceof Date ? b.getTime() : b;
    return Object.is(av, bv) ? [] : [{ path, a, b }];
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: DiffEntry[] = [];
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) out.push(...diff(a[i], b[i], `${path}[${i}]`));
    return out;
  }
  if (isObj(a) && isObj(b)) {
    const out: DiffEntry[] = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      out.push(...diff(a[k], b[k], path ? `${path}.${k}` : k));
    }
    return out;
  }
  return Object.is(a, b) ? [] : [{ path, a, b }];
}
