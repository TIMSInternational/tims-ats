# Rate-limit shared key layout (frozen contract)

This freezes the Redis key layout + budgets that let the **C# limiter and the TS
`@upstash/ratelimit` limiter share the same buckets**. Verified against
`node_modules/@upstash/ratelimit@2.0.8` (single-region `RegionRatelimit`,
`Ratelimit.slidingWindow`). Any change here MUST be made in lockstep on both stacks or the
buckets silently diverge.

## Categories → budget (sliding window)

| category | tokens | window   | windowMs |
| -------- | ------ | -------- | -------- |
| mutation | 30     | 1m       | 60000    |
| query    | 100    | 1m       | 60000    |
| auth     | 10     | 5m       | 300000   |
| ai       | 10     | 1m       | 60000    |
| export   | 5      | 5m       | 300000   |

Source: TS `LIMITS` in `packages/api/src/middleware/rate-limit.ts`; C# `RateLimits` in
`Tims.Domain.RateLimiting`.

## Key structure

```
prefix       = "tims:ratelimit:{category}"                 -- Upstash Ratelimit.prefix option
getKey(id)   = "{prefix}:{identifier}"                     -- [prefix, identifier].join(":")
bucket       = floor(now_ms / windowMs)                    -- computed in JS/C# (Math.floor(now/windowSize)), NOT in Lua
currentKey   = "{prefix}:{identifier}:{bucket}"            -- [getKey(id), currentWindow].join(":")
previousKey  = "{prefix}:{identifier}:{bucket - 1}"
dynamicLimitKey = ""                                       -- TIMS does not enable dynamic limits
```

So a resolved key is exactly:

```
tims:ratelimit:{category}:{identifier}:{bucket}
```

## EVAL contract

- Script: the verbatim single-region `slidingWindowLimitScript` (SHA
  `977fb636fb5ceb7e98a96d1b3a1272ba018efdae`). Reproduced in
  `Tims.Infrastructure.RateLimiting.RedisSlidingWindowRateLimiter.SlidingWindowLimitScript`.
- `KEYS = [currentKey, previousKey, dynamicLimitKey=""]`
- `ARGV = [tokens, now_ms, windowMs, incrementBy=1]`
- Return `{ remaining, effectiveLimit }`. `success = remaining >= 0` (Lua returns `{-1, limit}`
  when throttled). `reset = (bucket + 1) * windowMs`.
- On first INCRBY of a window: `PEXPIRE currentKey (windowMs * 2 + 1000)`.

## Identifier shape (per-caller bucket)

Built by `Tims.Domain.RateLimiting.RateLimitIdentity.For` / TS `trpc.ts`:

- external API-key surface → `apikey:{apiKeyId}`
- ai tier with org → `org:{organizationId}` (per-ORG budget)
- authed staff/owner → raw `{userId}` (no prefix)
- anonymous → `ip:{x-real-ip}` else `ip:{LAST x-forwarded-for hop}` else `anonymous`
  (NEVER the client-controlled first hop — see `rl-xff-spoof-bucket`).

## Cross-stack sharing — verified, not deploy-only

Because both stacks EVAL the identical Lua on identical keys, sharing is proven **locally** by the
Redis Testcontainer integration test (`RedisSlidingWindowRateLimiterTests`): it runs the C#
limiter, then `GET`s the exact `tims:ratelimit:{category}:{identifier}:{bucket}` counter and
asserts the value a TS reader would also see.

## Deploy-verify note

Against the real Upstash instance this is a *confirmation*, not a risk: point both stacks at the
same Upstash Redis (TCP endpoint), issue N requests from each, and confirm the shared counter at
`tims:ratelimit:{category}:{identifier}:{bucket}` reflects the combined total (i.e. the (N_ts +
N_cs)-th request over the limit is throttled regardless of which stack sent it). Upstash Redis
supports `EVAL`, so no REST-client obstacle exists.
