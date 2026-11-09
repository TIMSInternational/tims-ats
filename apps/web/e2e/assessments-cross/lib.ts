import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { expect, type Page } from '@playwright/test';

/** What stack/up.sh wrote (ASSESSMENTS_CROSS_STATE). Every URL in it is local. */
export interface CrossState {
  baseURL: string;
  apiURL: string;
  authURL: string;
  anonKey: string;
  caFile: string;
  atsDatabaseUrl: string;
  mailpitURL: string;
  owner: { email: string; password: string };
  staffPassword: string;
  orgSlug: string;
  suite: { dbContainer: string; apiUrl: string; playerOrigin: string; cronSecret: string };
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

export function readState(): CrossState | null {
  const file = process.env.ASSESSMENTS_CROSS_STATE;
  if (!file) return null;
  const s = JSON.parse(readFileSync(file, 'utf8')) as CrossState;
  for (const url of [
    s.baseURL,
    s.apiURL,
    s.authURL,
    s.mailpitURL,
    s.atsDatabaseUrl,
    s.suite.apiUrl,
    s.suite.playerOrigin,
  ]) {
    const host = new URL(url).hostname;
    if (!LOCAL.test(host)) throw new Error(`assessments-cross: refusing a non-local URL (${host})`);
  }
  if (!s.suite.dbContainer.startsWith('r10-') && !s.suite.dbContainer.includes('cross'))
    throw new Error('assessments-cross: the suite database container is not this harness’s');
  return s;
}

/** One SQL statement against the local ATS database; tuples only. */
export function atsSql(s: CrossState, sql: string): string {
  return execFileSync('psql', [s.atsDatabaseUrl, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    encoding: 'utf8',
  }).trim();
}

/** One SQL statement against the local suite database container; tuples only. */
export function suiteSql(s: CrossState, sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      s.suite.dbContainer,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-X',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    {
      encoding: 'utf8',
    },
  ).trim();
}

/** A JSON call over the throwaway CA (the C# API, or GoTrue through the proxy). */
export async function callJson(
  s: CrossState,
  method: string,
  url: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown; headers: Record<string, string | string[] | undefined> }> {
  const ca = readFileSync(s.caFile);
  const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  if (url.startsWith('http://')) {
    const r = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...opts.headers,
      },
      body: payload,
    });
    const text = await r.text();
    return {
      status: r.status,
      body: text ? (JSON.parse(text) as unknown) : null,
      headers: Object.fromEntries(r.headers),
    };
  }
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method,
        ca,
        headers: {
          'Content-Type': 'application/json',
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
          ...opts.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: unknown = text;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** A Supabase access token for a password user (GoTrue through the local proxy). */
export async function passwordToken(s: CrossState, email: string, password: string): Promise<string> {
  const r = await callJson(s, 'POST', `${s.authURL}/token?grant_type=password`, {
    headers: { apikey: s.anonKey },
    body: { email, password },
  });
  expect(r.status, `GoTrue password grant for ${email}`).toBe(200);
  return (r.body as { access_token: string }).access_token;
}

/** Staff sign-in through the real /login form. */
export async function staffSignIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('tu@empresa.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: /^(iniciar sesi[oó]n|sign in)$/i }).click();
  await expect(page).not.toHaveURL(/\/login(\?|$)/, { timeout: 45_000 });
}

interface MailpitMessage {
  ID: string;
  To: { Address: string }[];
  Subject: string;
  Created: string;
}

/** The newest 6-digit code mailed to `email` after `since` (GoTrue → the local Mailpit). */
export async function latestOtp(s: CrossState, email: string, since: number): Promise<string> {
  let code = '';
  await expect
    .poll(
      async () => {
        const list = (await (await fetch(`${s.mailpitURL}/api/v1/messages?limit=50`)).json()) as {
          messages: MailpitMessage[];
        };
        const mine = list.messages.filter(
          (m) =>
            m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()) && Date.parse(m.Created) >= since - 1000,
        );
        if (mine.length === 0) return '';
        const msg = (await (await fetch(`${s.mailpitURL}/api/v1/message/${mine[0].ID}`)).json()) as {
          Text: string;
          HTML: string;
        };
        const m = /\b(\d{6})\b/.exec(`${msg.Text} ${msg.HTML}`);
        code = m ? m[1] : '';
        return code;
      },
      { timeout: 60_000, message: `an OTP mail for ${email}` },
    )
    .not.toBe('');
  return code;
}

/** Run the suite's scheduled work now (what the external scheduler does every few minutes). */
export async function runSuiteCron(s: CrossState): Promise<number> {
  const r = await fetch(`${s.suite.apiUrl}/api/v1/cron/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.suite.cronSecret}` },
  });
  return r.status;
}

/** Evidence collected per hop, printed as annotations and kept in the report. */
export const evidence: Record<string, string> = {};
export function record(hop: string, detail: string): void {
  evidence[hop] = detail;
}
