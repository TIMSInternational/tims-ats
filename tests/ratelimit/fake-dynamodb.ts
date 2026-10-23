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
  UpdateExpression?: string;
  ConditionExpression?: string;
  ExpressionAttributeNames?: Record<string, string>;
  ExpressionAttributeValues?: Record<string, AttrValue>;
  ConsistentRead?: boolean;
};

export interface FakeDynamo {
  /** pk -> attribute name -> number (window counters `w<index>` and `expiresAt`). */
  items: Map<string, Record<string, number>>;
  calls: Array<{ op: string; input: Input; hasAbortSignal: boolean }>;
  clientConfigs: Array<Record<string, unknown>>;
  /** In-flight requests whose abort signal fired. */
  aborted: number;
  /**
   * When true, a GetItem WITHOUT ConsistentRead returns nothing, which is what DynamoDB may
   * legitimately return just after a write. A correct store must not depend on it.
   */
  staleEventualReads: boolean;
  /** When true, UpdateItem calls are queued and only take effect on releaseHeld(). */
  holdUpdates: boolean;
  releaseHeld(): Promise<void>;
  mode: FakeMode;
}

function conditionalFailure(): Error {
  const err = new Error('The conditional request failed');
  err.name = 'ConditionalCheckFailedException';
  return err;
}

// Evaluates the condition clauses the store sends. A clause the store stops sending is simply
// not enforced (so its removal is caught by a test); an unknown clause fails the test loudly.
function conditionHolds(input: Input, item: Record<string, number> | undefined): boolean {
  const cond = input.ConditionExpression;
  if (!cond) return true;
  const n = input.ExpressionAttributeNames ?? {};
  const v = input.ExpressionAttributeValues ?? {};
  const attr = (ref: string) => item?.[n[ref] ?? ref];
  return cond.split(' AND ').every((clause) => {
    switch (clause) {
      case '(attribute_not_exists(#cur) OR #cur < :max)':
        return attr('#cur') === undefined || attr('#cur')! < Number(v[':max']!.N);
      case '#prev = :prevSeen':
        return attr('#prev') === Number(v[':prevSeen']!.N);
      case 'attribute_not_exists(#prev)':
        return attr('#prev') === undefined;
      case 'attribute_not_exists(#next)':
        return attr('#next') === undefined;
      case 'attribute_not_exists(pk) OR #e <= :now':
        return item === undefined || item.expiresAt! <= Number(v[':now']!.N);
      default:
        throw new Error(`fake-dynamodb: unsupported condition clause "${clause}"`);
    }
  });
}

function applyUpdate(input: Input, item: Record<string, number>): void {
  const n = input.ExpressionAttributeNames ?? {};
  const v = input.ExpressionAttributeValues ?? {};
  const expr = input.UpdateExpression ?? '';
  const add = /ADD (#\w+) (:\w+)/.exec(expr);
  if (add) item[n[add[1]!]!] = (item[n[add[1]!]!] ?? 0) + Number(v[add[2]!]!.N);
  const set = /SET (#\w+) = (:\w+)/.exec(expr);
  if (set) item[n[set[1]!]!] = Number(v[set[2]!]!.N);
  const remove = /REMOVE (.+)$/.exec(expr);
  if (remove) for (const ref of remove[1]!.split(', ')) delete item[n[ref.trim()]!];
}

export function installFakeDynamo(mode: FakeMode = 'ok'): FakeDynamo {
  const held: Array<() => void> = [];
  const fake: FakeDynamo = {
    items: new Map(),
    calls: [],
    clientConfigs: [],
    aborted: 0,
    staleEventualReads: false,
    holdUpdates: false,
    async releaseHeld() {
      for (const run of held.splice(0)) run();
      // Let the store's continuations (re-read, retry) run.
      for (let i = 0; i < 50; i++) await Promise.resolve();
    },
    mode,
  };

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
        if (cmd.op === 'GetItem') {
          if (fake.staleEventualReads && cmd.input.ConsistentRead !== true) return Promise.resolve({});
          const pk = cmd.input.Key!.pk.S!;
          const item = fake.items.get(pk);
          if (!item) return Promise.resolve({});
          const Item: Record<string, AttrValue> = { pk: { S: pk } };
          for (const [k, val] of Object.entries(item)) Item[k] = { N: String(val) };
          return Promise.resolve({ Item });
        }
        if (cmd.op === 'UpdateItem') {
          const commit = (): Promise<unknown> => {
            const pk = cmd.input.Key!.pk.S!;
            const item = fake.items.get(pk);
            if (!conditionHolds(cmd.input, item)) return Promise.reject(conditionalFailure());
            const next = { ...(item ?? {}) };
            applyUpdate(cmd.input, next);
            fake.items.set(pk, next);
            return Promise.resolve({});
          };
          if (!fake.holdUpdates) return commit();
          return new Promise((res, rej) => held.push(() => void commit().then(res, rej)));
        }
        // PutItem
        const pk = cmd.input.Item!.pk.S!;
        if (!conditionHolds(cmd.input, fake.items.get(pk))) return Promise.reject(conditionalFailure());
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
