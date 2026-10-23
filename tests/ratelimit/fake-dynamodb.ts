import { resolve } from 'node:path';
import { vi } from 'vitest';

// In-memory stand-in for @aws-sdk/client-dynamodb that implements exactly the three
// operations (and expression shapes) rate-limit-store.ts issues, so tests exercise the real
// sliding-window and claim logic. pnpm hosts the SDK under packages/api only; mock it by
// that path so the module id matches what rate-limit-store.ts resolves.
export const DYNAMODB_SDK = resolve(__dirname, '../../packages/api/node_modules/@aws-sdk/client-dynamodb');

export type FakeMode = 'ok' | 'hang' | 'error';

interface AttrValue {
  S?: string;
  N?: string;
}
type Input = {
  TableName: string;
  Key?: { pk: AttrValue };
  Item?: { pk: AttrValue; expiresAt: AttrValue };
  ExpressionAttributeValues?: Record<string, AttrValue>;
  ConditionExpression?: string;
  ConsistentRead?: boolean;
};

// Only the exact condition strings the store sends are enforced; a missing or different
// condition is treated as "no condition", so a store that stops sending one is caught.
const UPDATE_CONDITION = 'attribute_not_exists(#c) OR #c < :max';
const PUT_CONDITION = 'attribute_not_exists(pk) OR #e <= :now';

export interface FakeDynamo {
  items: Map<string, { c?: number; expiresAt?: number }>;
  calls: Array<{ op: string; input: Input; hasAbortSignal: boolean }>;
  clientConfigs: Array<Record<string, unknown>>;
  /** In-flight requests whose abort signal fired. */
  aborted: number;
  /**
   * When true, a GetItem WITHOUT ConsistentRead returns nothing, which is what DynamoDB may
   * legitimately return just after a write. A correct store must not depend on it.
   */
  staleEventualReads: boolean;
  mode: FakeMode;
}

function conditionalFailure(): Error {
  const err = new Error('The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
}

export function installFakeDynamo(mode: FakeMode = 'ok'): FakeDynamo {
  const fake: FakeDynamo = { items: new Map(), calls: [], clientConfigs: [], aborted: 0, staleEventualReads: false, mode };

  vi.doMock(DYNAMODB_SDK, () => {
    class Command {
      constructor(
        readonly op: string,
        readonly input: Input,
      ) {}
    }
    class GetItemCommand extends Command {
      constructor(input: Input) {
        super('GetItem', input);
      }
    }
    class UpdateItemCommand extends Command {
      constructor(input: Input) {
        super('UpdateItem', input);
      }
    }
    class PutItemCommand extends Command {
      constructor(input: Input) {
        super('PutItem', input);
      }
    }
    class DynamoDBClient {
      constructor(config: Record<string, unknown>) {
        fake.clientConfigs.push(config);
      }
      send(cmd: Command, opts?: { abortSignal?: AbortSignal }): Promise<unknown> {
        fake.calls.push({ op: cmd.op, input: cmd.input, hasAbortSignal: Boolean(opts?.abortSignal) });
        if (fake.mode === 'hang') {
          return new Promise((_, reject) => {
            opts?.abortSignal?.addEventListener('abort', () => {
              fake.aborted++;
              const err = new Error('Request aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });
        }
        if (fake.mode === 'error') {
          const err = new Error('getaddrinfo ENOTFOUND dynamodb.us-west-2.amazonaws.com account 747814092517');
          err.name = 'ProvisionedThroughputExceededException';
          return Promise.reject(err);
        }
        const values = cmd.input.ExpressionAttributeValues ?? {};
        if (cmd.op === 'GetItem') {
          if (fake.staleEventualReads && cmd.input.ConsistentRead !== true) return Promise.resolve({});
          const item = fake.items.get(cmd.input.Key!.pk.S!);
          return Promise.resolve({ Item: item?.c !== undefined ? { c: { N: String(item.c) } } : undefined });
        }
        if (cmd.op === 'UpdateItem') {
          const pk = cmd.input.Key!.pk.S!;
          const item = fake.items.get(pk) ?? {};
          if (cmd.input.ConditionExpression === UPDATE_CONDITION) {
            const max = Number(values[':max']!.N);
            if (item.c !== undefined && !(item.c < max)) return Promise.reject(conditionalFailure());
          }
          item.c = (item.c ?? 0) + 1;
          item.expiresAt ??= Number(values[':exp']!.N);
          fake.items.set(pk, item);
          return Promise.resolve({});
        }
        // PutItem
        const pk = cmd.input.Item!.pk.S!;
        const existing = fake.items.get(pk);
        if (cmd.input.ConditionExpression === PUT_CONDITION) {
          const now = Number(values[':now']!.N);
          if (existing && !(existing.expiresAt! <= now)) return Promise.reject(conditionalFailure());
        }
        fake.items.set(pk, { expiresAt: Number(cmd.input.Item!.expiresAt.N) });
        return Promise.resolve({});
      }
    }
    return { DynamoDBClient, GetItemCommand, UpdateItemCommand, PutItemCommand };
  });
  return fake;
}

export function stubSharedStoreEnv(vercelEnv: string, table = 'tims-ats-ratelimit', region = 'us-west-2'): void {
  vi.stubEnv('VERCEL_ENV', vercelEnv);
  vi.stubEnv('RATE_LIMIT_DYNAMODB_TABLE', table);
  vi.stubEnv('RATE_LIMIT_DYNAMODB_REGION', region);
}
