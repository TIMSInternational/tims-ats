# Rate-limit shared key layout (frozen contract)

This freezes the item layout + budgets that let the **C# limiter and the TS limiter share the same
buckets** in ONE DynamoDB table (2026-10-22: both stacks moved off Upstash Redis together). The exact
partition keys, attribute names and DynamoDB expressions are machine-checked in
[`dynamodb.json`](./dynamodb.json), which both suites assert:
`tests/ratelimit/dynamodb-contract.test.ts` (TS) and `DynamoDbKeyLayoutFixtureTests` +
`DynamoDbContractFixtureTests` (C#). Any change here MUST be made in lockstep on both stacks or the
buckets silently diverge — a caller would get a separate budget on each stack.

## Categories → budget (sliding window)

| category | tokens | window | windowMs |
| -------- | ------ | ------ | -------- |
| mutation | 30     | 1m     | 60000    |
| query    | 100    | 1m     | 60000    |
| auth     | 10     | 5m     | 300000   |
| ai       | 10     | 1m     | 60000    |
| export   | 5      | 5m     | 300000   |

Source: TS `LIMITS` in `packages/api/src/middleware/rate-limit.ts`; C# `RateLimits` in
`Tims.Domain.RateLimiting`.

## Item structure

```
table            = one on-demand table (prod: tims-ats-ratelimit, us-west-2); partition key `pk` (S); TTL `expiresAt`
pk               = "rl#{category}#{lowercase hex sha256(utf8 identifier)}"   -- the raw identifier never reaches the table
bucket           = floor(now_ms / windowMs)                                   -- computed in TS/C#
counter          = attribute "w{bucket}" (N) on that ONE item — one per window
expiresAt        = ceil((bucket + 2) * windowMs / 1000) + 60                  -- outlives the next window
```

Code: TS `packages/api/src/middleware/rate-limit-store.ts`; C#
`Tims.Infrastructure.RateLimiting.DynamoDbRateLimitStore` + `Tims.Domain.RateLimiting.RateLimits`.

## Admission contract (the algorithm both stacks run)

Same decision as `@upstash/ratelimit`'s single-region `slidingWindow`, made atomic with one conditional
write instead of a Lua script:

1. Strongly consistent `GetItem(pk)`; read `w{bucket}` (current) and `w{bucket-1}` (previous).
2. `allowed = tokens - floor(previous * (1 - (now % windowMs) / windowMs))`; if `current >= allowed`, deny
   WITHOUT writing (a denied request is not counted). `reset = (bucket + 1) * windowMs`.
3. `UpdateItem` with `ADD #cur :one SET #e = :exp` (plus `REMOVE` of counters older than the previous
   window) under the condition in `dynamodb.json`: the current window has room, the previous window is
   exactly what was weighed (`#prev = :prevSeen`, or absent), and no later window exists.
4. A conditional failure means the item moved: re-read and decide again, at most 3 attempts; if still
   contended, DENY with a 1 s retry hint (the store is healthy — never fall through to an outage path).
5. A later window already present on the item (another instance's clock is ahead) is adopted, and the
   previous window then counts in full.
6. No SDK retries (an increment is not idempotent); each store call is bounded to 1 s.

Claims (one write, no counter): `PutItem` with `attribute_not_exists(pk) OR #e <= :now` — the TS
application-email cap (`ae#sha256(address)`, 24 h) and the C# relay nonce (`relay#sha256(nonce)`, 90 s).

## Identifier shape (per-caller bucket)

Built by `Tims.Domain.RateLimiting.RateLimitIdentity.For` / TS `trpc.ts`:

- external API-key surface → `apikey:{apiKeyId}`
- ai tier with org → `org:{organizationId}` (per-ORG budget)
- authed staff/owner → raw `{userId}` (no prefix)
- anonymous → `ip:{x-real-ip}` else `ip:{LAST x-forwarded-for hop}` else `anonymous`
  (NEVER the client-controlled first hop — see `rl-xff-spoof-bucket`).

## Cross-stack sharing — verified, not deploy-only

The C# suite runs the store against a real DynamoDB engine (DynamoDB Local, `DynamoDbRateLimitStoreTests`):
it inspects the exact items written, and proves C# honors an item written in the TS shape
(`Honors_an_item_written_by_the_TS_stack`). Both suites assert the same `dynamodb.json`, so the TS store
addresses the same items with the same expressions.

## Deploy-verify note

After both stacks are deployed against the production table, issue N requests from each surface as one
caller and confirm the item `rl#{category}#sha256(identifier)` carries the combined count in `w{bucket}`
(the (N_ts + N_cs)-th request over the limit is throttled regardless of which stack sent it).
