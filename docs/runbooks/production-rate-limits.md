# Production web rate limits

The Next.js/tRPC app uses `@upstash/ratelimit`. A Vercel function's process memory is
not shared with other instances, so its in-memory fallback is suitable only for
local development and previews. Production requires both
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in the **Vercel Production**
environment. These are the Upstash **REST** endpoint and token; the Redis RESP
connection string used by the C# App Runner service is not a drop-in replacement.
Store the token as sensitive. Do not print either credential in CI logs or a PR.

## Activation order

1. Verify that the selected Upstash REST credential can read and write one
   disposable key, and delete that key. Check the database/region and expected
   monthly request budget. Do not use a read-only token.
2. Add both values to the Vercel **Production** environment. Confirm their names
   appear there, without reading their values back. Adding variables alone does
   not change an existing deployment.
3. Merge the production guard only after step 2, then deploy or redeploy a build
   that includes both variables. A build without them must fail rather than
   silently use per-instance counters.
4. From two independent sessions, exercise a harmless bounded endpoint against
   the production alias and verify the same Redis counter advances. Verify the
   expected `TOO_MANY_REQUESTS` response after the tier limit and that normal
   requests resume after the window. Keep test volume below the service plan's
   budget and avoid account-lockout paths.
5. Check Vercel error rate and Redis request/latency metrics. A Redis failure or
   limiter timeout now returns `SERVICE_UNAVAILABLE` for tRPC requests. The
   public application email cap also fails closed, skipping the email.

## Rollback

If the web deployment fails after the configuration change, restore the previous
working deployment while retaining the Redis variables, then investigate the
error. Do not remove either variable while the production guard is deployed:
that would prevent tRPC from starting. Rotate a compromised REST token in Upstash
and Vercel together, then redeploy and verify the shared counter again.

This runbook covers the web tRPC limiter. The C# platform API uses its own Redis
connection setting and must be verified separately.
