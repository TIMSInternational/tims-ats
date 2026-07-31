# External-Vendor Write Re-Verify — Runbook

**Who runs this:** Federico. The API key created in Step 1 is a real production credential
scoped to write pre-employment validation results — same "I never touch prod directly with
Claude" discipline as `fx-seed-once-runbook.md`. Claude built and parity-verified
`submitValidationResult` against a local/Testcontainers harness but has never created a real
production API key or sent a real vendor-authenticated request against prod.

## Why

`EXTERNAL_VENDOR_WRITE_VIA_CSHARP` is dark. The C# side
(`Platform__ExternalVendorWriteEnabled=true`) is already live on App Runner — flipping the
Vercel flag is a 1-line change once this is re-verified. The blocker is that the only way to
prove the write path works end-to-end is a real API-key-authenticated HTTP call (this endpoint
is `externalPermissionProcedure`-gated, not staff-session-gated — there is no staff UI path
that exercises it), and no scoped key with `validation:write` currently exists to test with.

## Steps

1. **Create a scoped API key.** In the app: Settings → Integrations → API Keys → Create.
   - Environment: `production`
   - Scopes: `validation:write` (exactly this string — the endpoint's
     `externalPermissionProcedure('validation', 'update', 'validation:write', true)` enforces
     this scope _unconditionally_, so an empty-scope key cannot reach it even with the
     `validation:update` role grant)
   - Copy the returned key immediately — it's shown once.

2. **Send one real test submission against the current (TS) path.** The key authenticates via
   the `Authorization` header (`Bearer <key>` — check `api-keys-manager.tsx` or the API docs
   for the exact scheme it issues). Example:

   ```bash
   # never commit or paste the real key value anywhere
   curl -X POST "https://<your-prod-domain>/api/trpc/external.submitValidationResult" \
     -H "Authorization: Bearer $EXTERNAL_VENDOR_TEST_KEY" \
     -H "Content-Type: application/json" \
     -d '{"assignmentId": "<a real pending assessmentAssignment id in a test org>", ...}'
   ```

   Confirm: a `200` with the expected shape, a `409` on a duplicate submission (already-resolved
   assignment), and the correct row appears in the `data_access_logs`/audit trail with the
   right `apiKeyId` attribution. (See `docs/architecture/csharp-migration/phase-5-slice-2-external-vendor-write.md`
   for the full request/response contract if you need the exact field names.)

3. **Confirm the C# side behaves identically.** The parity harness
   (`scripts/parity/cli.ts verify external-vendor-write`) should already cover this — run it
   with the new key loaded per `scripts/deploy/set-parity-secrets.sh`'s pattern, or send the
   same request directly at the C# service's own endpoint if you want a completely independent
   check. Confirm: same 200/409 behavior, same audit attribution.

4. **Tell Claude the result** — just pass/fail per step above, never the key value itself. If
   both TS and C# behaved identically and the audit trail is correct, the flip is safe.

5. **Flip is a 1-line Vercel env change** (`NEXT_PUBLIC_EXTERNAL_VENDOR_WRITE_VIA_CSHARP=true`)
   — Claude can do this step and the subsequent TS-deletion, same as every other domain this
   session-chain.

## Re-running

The API key is reusable — no need to create a new one for future re-tests unless it's rotated
or revoked. If you ever paste the key value anywhere non-private (chat, ticket, etc.), revoke
and recreate it immediately via the same UI.
