import { createHash } from 'node:crypto';

import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';

// ---------------------------------------------------------------------------
// Shared rate-limit store: one DynamoDB table (on-demand), partition key `pk` (string),
// TTL attribute `expiresAt` (epoch seconds). Provisioned by the owner kit, never by the app.
//
// RATE_LIMIT_DYNAMODB_TABLE + RATE_LIMIT_DYNAMODB_REGION are REQUIRED together, with no
// AWS_REGION fallback: on Vercel AWS_REGION is the function's own region (and is set to the
// SES region for the e-mail client), so a fallback could silently point at a table that
// does not exist. Credentials come from the default chain, like the S3 and SES clients.
//
// Keys never contain the raw identifier (user id, client IP, api-key id): it is sha256'd.
// ---------------------------------------------------------------------------

export const SHARED_LIMIT_TIMEOUT_MS = 1_000;

const TABLE_RE = /^[A-Za-z0-9_.-]{3,255}$/;
const REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d$/;

export interface SharedStoreConfig {
  table: string;
  region: string;
}

/** Reads and validates the store env. Throws on a half or malformed configuration. */
export function readSharedStoreConfig(env: NodeJS.ProcessEnv): SharedStoreConfig | undefined {
  const table = env.RATE_LIMIT_DYNAMODB_TABLE ?? '';
  const region = env.RATE_LIMIT_DYNAMODB_REGION ?? '';
  if (!table && !region) return undefined;
  if (!table || !region) {
    throw new Error('Rate limiting requires both RATE_LIMIT_DYNAMODB_TABLE and RATE_LIMIT_DYNAMODB_REGION');
  }
  if (!TABLE_RE.test(table)) throw new Error('RATE_LIMIT_DYNAMODB_TABLE is not a valid DynamoDB table name');
  if (!REGION_RE.test(region)) throw new Error('RATE_LIMIT_DYNAMODB_REGION is not a valid AWS region');
  return { table, region };
}

export class SharedLimiterTimeoutError extends Error {
  constructor() {
    super('Shared rate limiter timed out');
    this.name = 'SharedLimiterTimeoutError';
  }
}

/**
 * Runs `fn` under a hard deadline. On expiry the in-flight AWS request is aborted (so the
 * socket is released) and the call rejects with SharedLimiterTimeoutError; the timer never
 * outlives the call.
 */
async function withDeadline<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SharedLimiterTimeoutError());
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isConditionalCheckFailed(err: unknown): boolean {
  return err instanceof Error && err.name === 'ConditionalCheckFailedException';
}

function hashIdentifier(identifier: string): string {
  return createHash('sha256').update(identifier).digest('hex');
}

/** Bounded re-reads when the windows move under a request; contention never loops forever. */
const SLIDING_WINDOW_ATTEMPTS = 3;

/** Retry hint when re-reads are exhausted: the store is healthy, the caller is just contended. */
const CONTENTION_RETRY_MS = 1_000;

/** Window index -> count, from an item's `w<index>` attributes. */
function windowCounts(item: Record<string, { N?: string }> | undefined): Map<number, number> {
  const counts = new Map<number, number>();
  for (const [name, value] of Object.entries(item ?? {})) {
    const m = /^w(\d+)$/.exec(name);
    if (m && value.N !== undefined) counts.set(Number(m[1]), Number(value.N));
  }
  return counts;
}

export interface SlidingWindowResult {
  success: boolean;
  /** Epoch ms when the current window ends. */
  reset: number;
}

export interface SharedStore {
  /**
   * Sliding-window limit, same algorithm as @upstash/ratelimit's slidingWindow: the
   * previous window's count is weighted by how much of it still overlaps, and a denied
   * request is NOT counted. Like Upstash's single Lua script, admission is atomic: both
   * windows live on one item and one conditional write checks them together. Rejects on
   * timeout or on any store error. If the windows keep moving (late writes landing on every
   * re-read), the request is DENIED, not failed: the store is healthy and the caller is at its
   * quota, so the outage path (which grants a fresh per-instance budget) must not apply.
   */
  slidingWindow(prefix: string, identifier: string, limit: number, windowMs: number): Promise<SlidingWindowResult>;
  /**
   * Claims `key` for `windowMs` (rolling). true = claimed now; false = already claimed
   * within the window. Rejects on timeout or any store error.
   */
  claimOnce(prefix: string, key: string, windowMs: number): Promise<boolean>;
}

export function createSharedStore(config: SharedStoreConfig): SharedStore {
  const client = new DynamoDBClient({
    region: config.region,
    // No automatic retries: the counter increment is not idempotent, so a retry after a write
    // that committed but lost its response would count one request twice. A transient error
    // takes the outage path instead (fail closed for the strict tiers, memory for the rest).
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 300, requestTimeout: SHARED_LIMIT_TIMEOUT_MS },
  });
  const TableName = config.table;

  return {
    slidingWindow(prefix, identifier, limit, windowMs) {
      return withDeadline(async (abortSignal) => {
        const Key = { pk: { S: `${prefix}#${hashIdentifier(identifier)}` } };
        for (let attempt = 0; attempt < SLIDING_WINDOW_ATTEMPTS; attempt++) {
          const read = await client.send(new GetItemCommand({ TableName, Key, ConsistentRead: true }), { abortSignal });
          const counts = windowCounts(read.Item);
          const now = Date.now();
          let current = Math.floor(now / windowMs);
          let overlap = 1 - (now % windowMs) / windowMs;
          // Another instance's clock is ahead and already opened a later window: adopt it, and
          // count the previous window in full (we cannot know how far into it we are).
          const newest = Math.max(-Infinity, ...counts.keys());
          if (newest > current) {
            current = newest;
            overlap = 1;
          }
          const reset = (current + 1) * windowMs;
          const previousCount = counts.get(current - 1) ?? 0;
          const currentCount = counts.get(current) ?? 0;
          const allowedInCurrent = limit - Math.floor(previousCount * overlap);
          if (currentCount >= allowedInCurrent) return { success: false, reset };

          const names: Record<string, string> = {
            '#cur': `w${current}`,
            '#prev': `w${current - 1}`,
            '#next': `w${current + 1}`,
            '#e': 'expiresAt',
          };
          const stale = [...counts.keys()].filter((w) => w < current - 1);
          stale.forEach((w, i) => (names[`#old${i}`] = `w${w}`));
          const values: Record<string, { N: string }> = {
            ':one': { N: '1' },
            ':max': { N: String(allowedInCurrent) },
            // The item must outlive the NEXT window too: this window is that one's "previous".
            ':exp': { N: String(Math.ceil(((current + 2) * windowMs) / 1000) + 60) },
          };
          if (previousCount > 0) values[':prevSeen'] = { N: String(previousCount) };
          try {
            await client.send(
              new UpdateItemCommand({
                TableName,
                Key,
                UpdateExpression:
                  'ADD #cur :one SET #e = :exp' +
                  (stale.length ? ` REMOVE ${stale.map((_, i) => `#old${i}`).join(', ')}` : ''),
                // One atomic check over both windows of ONE item:
                //  - room left in the current window (concurrent requests in it never conflict);
                //  - the previous window is exactly what we weighed (a late write landed → re-read);
                //  - no later window has started (a request computed before a boundary that
                //    commits after it must not add to the closed window → re-read at the new time).
                ConditionExpression:
                  '(attribute_not_exists(#cur) OR #cur < :max) AND ' +
                  (previousCount > 0 ? '#prev = :prevSeen' : 'attribute_not_exists(#prev)') +
                  ' AND attribute_not_exists(#next)',
                ExpressionAttributeNames: names,
                ExpressionAttributeValues: values,
              }),
              { abortSignal },
            );
            return { success: true, reset };
          } catch (err) {
            if (!isConditionalCheckFailed(err)) throw err;
            // Full, or the windows moved under us: re-read and decide again.
          }
        }
        return { success: false, reset: Date.now() + CONTENTION_RETRY_MS };
      }, SHARED_LIMIT_TIMEOUT_MS);
    },

    claimOnce(prefix, key, windowMs) {
      return withDeadline(async (abortSignal) => {
        const nowSec = Math.floor(Date.now() / 1000);
        try {
          await client.send(
            new PutItemCommand({
              TableName,
              Item: {
                pk: { S: `${prefix}#${key}` },
                expiresAt: { N: String(nowSec + Math.ceil(windowMs / 1000)) },
              },
              // DynamoDB TTL deletes lazily, so an expired claim may still be present.
              ConditionExpression: 'attribute_not_exists(pk) OR #e <= :now',
              ExpressionAttributeNames: { '#e': 'expiresAt' },
              ExpressionAttributeValues: { ':now': { N: String(nowSec) } },
            }),
            { abortSignal },
          );
          return true;
        } catch (err) {
          if (isConditionalCheckFailed(err)) return false;
          throw err;
        }
      }, SHARED_LIMIT_TIMEOUT_MS);
    },
  };
}
