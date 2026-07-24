import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface HarnessConfig {
  supabaseUrl: string; projectRef: string; serviceRoleKey: string;
  anonKey: string; csharpBase: string; tsBase: string;
}

const REQUIRED = {
  supabaseUrl: 'SUPABASE_URL', projectRef: 'SUPABASE_PROJECT_REF',
  serviceRoleKey: 'SUPABASE_SERVICE_ROLE_KEY', anonKey: 'SUPABASE_ANON_KEY',
  csharpBase: 'TIMS_CSHARP_BASE', tsBase: 'TIMS_TS_BASE',
} as const;

export function parseConfig(env: Record<string, string | undefined>): HarnessConfig {
  const missing: string[] = [];
  const out = {} as Record<keyof typeof REQUIRED, string>;
  for (const [key, varName] of Object.entries(REQUIRED) as [keyof typeof REQUIRED, string][]) {
    const v = env[varName];
    if (!v) missing.push(varName); else out[key] = v;
  }
  if (missing.length) throw new ConfigError(`Missing env vars: ${missing.join(', ')}`);
  return out as HarnessConfig;
}

/** Parses .env-style text (KEY=VALUE lines) into a plain object, stripping full-line
 *  and whitespace-preceded inline comments per dotenv convention. Pure + testable. */
export function parseEnvText(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    // strip a whitespace-preceded inline comment (dotenv convention), then trim
    const value = m[2].replace(/\s+#.*$/, '').trim();
    out[m[1]] = value;
  }
  return out;
}

/** Loads scripts/parity/.env (KEY=VALUE lines) merged over process.env, then parses. */
export function loadConfig(): HarnessConfig {
  let env: Record<string, string | undefined> = { ...process.env };
  try {
    const raw = readFileSync(join(__dirname, '.env'), 'utf8');
    const fileVars = parseEnvText(raw);
    env = { ...process.env, ...fileVars };
  } catch { /* .env optional if vars already in process.env */ }
  return parseConfig(env);
}
