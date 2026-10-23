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

export interface SlidingWindowResult {
  success: boolean;
  /** Epoch ms when the current window ends. */
  reset: number;
}

export interface SharedStore {
  /**
   * Sliding-window limit, same algorithm as @upstash/ratelimit's slidingWindow: the
   * previous window's count is weighted by how much of it still overlaps, and a denied
   * request is NOT counted. Rejects on timeout or any store error.
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
        const now = Date.now();
        const current = Math.floor(now / windowMs);
        const base = `${prefix}#${hashIdentifier(identifier)}#`;
        const reset = (current + 1) * windowMs;

        const previous = await client.send(
          new GetItemCommand({
            TableName,
            Key: { pk: { S: `${base}${current - 1}` } },
            // Strongly consistent: just after a window boundary an eventually consistent read
            // can miss the previous window's latest increments and roughly double the quota.
            ConsistentRead: true,
            ProjectionExpression: '#c',
            ExpressionAttributeNames: { '#c': 'c' },
          }),
          { abortSignal },
        );
        const previousCount = Number(previous.Item?.c?.N ?? '0');
        const overlap = 1 - (now % windowMs) / windowMs;
        const allowedInCurrent = limit - Math.floor(previousCount * overlap);
        if (allowedInCurrent <= 0) return { success: false, reset };

        try {
          await client.send(
            new UpdateItemCommand({
              TableName,
              Key: { pk: { S: `${base}${current}` } },
              // The item must outlive the NEXT window too: it is that window's "previous".
              UpdateExpression: 'ADD #c :one SET #e = if_not_exists(#e, :exp)',
              ConditionExpression: 'attribute_not_exists(#c) OR #c < :max',
              ExpressionAttributeNames: { '#c': 'c', '#e': 'expiresAt' },
              ExpressionAttributeValues: {
                ':one': { N: '1' },
                ':max': { N: String(allowedInCurrent) },
                ':exp': { N: String(Math.ceil(((current + 2) * windowMs) / 1000) + 60) },
              },
            }),
            { abortSignal },
          );
          return { success: true, reset };
        } catch (err) {
          if (isConditionalCheckFailed(err)) return { success: false, reset };
          throw err;
        }
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
