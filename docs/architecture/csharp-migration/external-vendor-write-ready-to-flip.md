# External-vendor write: ready to flip

**Who this is for:** Federico. **Time:** under 10 minutes once you have 2 minutes to create an
API key. **Prerequisite:** none of this needs Claude — every step below is either a UI click or a
`vercel` CLI command you run yourself.

**What "flipping" means:** turning on `EXTERNAL_VENDOR_WRITE_VIA_CSHARP` in Vercel prod, which
switches the inbound vendor endpoint `external.submitValidationResult` (pre-employment validation
results submitted by the external vendor) from the TS/Prisma write path to the already-live C#
write path. This is the **last dark write surface** in the whole domain — read is already flipped
and live (2026-07-31).

Everything below was re-verified directly against the running services on 2026-07-31 (not just
read from docs — commands and their actual output are included so you can trust the claims).

---

## 0. Why this is the only blocker

Every piece of app code this needs is already built, deployed, and confirmed live:

| Piece                                                        | Status                                                                       | Evidence |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------- | -------- |
| C# write endpoint (`POST /external/validations/{id}/result`) | **Deployed + mounted on the live App Runner service right now**              | see §1   |
| TS proxy code (server-side flag flip, no rebuild needed)     | **Built, dark, one env var away**                                            | see §2   |
| UI to create a scoped API key                                | **Built and working**                                                        | see §3   |
| `external` role's `validation:update` permission grant       | **Already seeded in prod**                                                   | see §3   |
| Automated parity-harness command to verify after flipping    | **Does not exist for this surface** — see §4 for why and what to run instead |

The only thing that requires a human is minting a real production API key (Settings →
Integrations issues a real credential — same "no Claude touches prod credentials directly" rule
as the FX-seed and other flips) and sending one real authenticated request with it. That's it.

---

## 1. C# endpoint — confirmed deployed and live right now

Health check:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://w7kk5w3si4.us-west-2.awsapprunner.com/health
# → 200
```

The write route itself, called with no auth header (this is the same probe the parity harness
uses to distinguish "flag off / route not mapped" from "flag on / route mapted but rejecting"):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://w7kk5w3si4.us-west-2.awsapprunner.com/external/validations/00000000-0000-0000-0000-000000000000/result \
  -H "Content-Type: application/json" -d '{}'
# → 401
```

**401, not 404.** Per `Program.cs` (`services/Tims.Platform/src/Tims.Api/Program.cs:807-814`), the
route is only mapped into the app at all when `Platform__ExternalVendorWriteEnabled=true`; if the
flag were off, this would 404 (route not mapped) or the connection would look identical to a typo
URL. A 401 means the route exists and its ApiKey-auth gate is doing its job. **This confirms the C#
backend flag is live on the App Runner image today** — independent of what any doc claims.

The endpoint itself (`ExternalValidationEndpoints.cs`): `POST /external/validations/{validationId:guid}/result`,
ApiKey-scheme auth → `validation:write` scope (enforced unconditionally) → `validation:update` role
grant → atomic pending-only update → `200` (success) / `400` (bad body) / `404` (not found /
wrong org) / `409` (already resolved). Fail-soft audit (a lost audit row never blocks a real
vendor submission).

---

## 2. TS proxy — already built, flag is a plain server env var (NOT `NEXT_PUBLIC_`)

`packages/api/src/services/external-validation.service.ts`:

```ts
const EXTERNAL_VENDOR_WRITE_VIA_CSHARP = process.env.EXTERNAL_VENDOR_WRITE_VIA_CSHARP === 'true';
...
if (isPlatformApiEnabled() && EXTERNAL_VENDOR_WRITE_VIA_CSHARP) {
  // proxies to POST /external/validations/{id}/result on the C# service, forwarding the
  // vendor's own Authorization header so the SAME key re-authenticates against C#
}
```

**Correction to an older doc:** `external-vendor-write-reverify-runbook.md` (step 5) says the flag
is `NEXT_PUBLIC_EXTERNAL_VENDOR_WRITE_VIA_CSHARP`. That's stale/wrong — checked against the actual
code above and against `docs/REMAINING-WORK.md`'s own read-side note ("a plain server env var, not
`NEXT_PUBLIC_`, since this surface is TS-server-to-C# rather than browser-to-C#"), the correct name
is **`EXTERNAL_VENDOR_WRITE_VIA_CSHARP`** — no `NEXT_PUBLIC_` prefix. This is exactly the same
pattern as the read flag, `EXTERNAL_VENDOR_READ_VIA_CSHARP`, which is already flipped live. No
browser code is ever involved (the vendor calls the TS API directly), so there is no reason for the
value to be exposed to the client bundle.

Confirmed via the CLI what's actually set in Vercel prod right now:

```bash
npx vercel env ls production | grep EXTERNAL_VENDOR
#  EXTERNAL_VENDOR_READ_VIA_CSHARP    Encrypted   Production   15h ago
```

`EXTERNAL_VENDOR_WRITE_VIA_CSHARP` does **not** appear — confirming it really is still dark, and
that flipping it is the one missing line.

No code change, no rebuild, no redeploy of the C# service is needed for step 5 below — only a
Vercel env var + a Vercel redeploy (env var changes only take effect on the _next_ deployment).

---

## 3. Where you create the key (Settings → Integrations)

Confirmed working page: `apps/web/app/(admin)/settings/integrations/page.tsx`, route
`/settings/integrations`. The "API Keys" card (`api-keys-manager.tsx`) has a **New API Key**
button → modal with Name / Environment / Scopes fields → **Create** → the raw key is shown
**once** in a follow-up modal (copy it immediately, it is never shown again).

**Exact values to enter:**

- **Name:** anything identifying (e.g. `vendor-write-reverify`)
- **Environment:** `production`
- **Scopes:** `validation:write` — type this **exact string**, nothing else. The endpoint enforces
  this scope unconditionally (`alwaysEnforceScope=true`), so an empty-scope key cannot reach it
  even though the underlying role grant would otherwise allow it.

**No role-grant setup needed.** The `external` role already has the `validation:update` permission
grant seeded in prod (`packages/db/prisma/seed-access-matrix.ts:131-133` —
`{ module: 'validation', actions: ['update'], scope: 'organization' }`). The scope string on the
key is the only thing you're providing; the grant side is already there.

---

## 4. Verifying end-to-end — no automated harness command exists for this surface, use these two curls instead

**Correction to the existing runbook:** `external-vendor-write-reverify-runbook.md` step 3 says to
run `scripts/parity/cli.ts verify external-vendor-write`. That command does not exist — checked
`scripts/parity/write-surfaces.ts`'s `WRITE_SURFACES` registry directly, and it only contains
`compensation`, `evaluation360`, `succession`, `engagement`, `ninebox`, `access-review`.
External-vendor was never added to the automated write-parity harness (it predates it — this was
the very first C#-write slice, Phase-5 Slice 2, before the harness existed). Don't rely on a CLI
command here; use the two manual requests below instead, exactly as the original runbook's step 2
intended.

### 4a. Test the current (TS) path — proves the key works at all

```bash
# never paste the real key value anywhere outside this one-off local command
curl -s -w "\n%{http_code}\n" -X POST "https://<your-prod-domain>/api/trpc/external.submitValidationResult" \
  -H "Authorization: Bearer $EXTERNAL_VENDOR_TEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{"validationId": "<a real PENDING preemploymentValidation id in a test org>", "status": "passed", "result": {"cleared": true}, "notes": "reverify"}'
```

Note the body field is **`validationId`** (not `assignmentId` — the older runbook's example had
this wrong; the actual input schema is `packages/api/src/dto/external-validation.ts`:
`{ validationId: uuid, status: 'passed'|'failed', result: object (≤100KB), notes?: string (≤5000) }`).

Confirm:

- **200** with `{ schemaVersion: 'v1', id, status: 'passed', completedAt }`
- Re-running the **same** request → **409** (already resolved, pending-only guard)
- The row in `data_access_logs` attributes the write to the key's `apiKeyId`

### 4b. Test the C# path directly — proves it behaves identically, before touching the flag

Same key, same body, straight at the App Runner service (bypassing Vercel/TS entirely — this is
safe to run _before_ flipping anything, since the C# backend flag is already on):

```bash
curl -s -w "\n%{http_code}\n" -X POST \
  "https://w7kk5w3si4.us-west-2.awsapprunner.com/external/validations/<same validation id>/result" \
  -H "Authorization: Bearer $EXTERNAL_VENDOR_TEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "passed", "result": {"cleared": true}, "notes": "reverify"}'
```

(Route param carries the id here, not a body field — that's a C#-side difference in shape, not a
bug; the TS proxy translates between the two.) Confirm the **same** 200 → 409-on-retry behavior,
same audit attribution.

If 4a and 4b agree, the write path is proven identical and the flip is safe.

---

## 5. Flip it (1 line + a redeploy)

```bash
npx vercel env add EXTERNAL_VENDOR_WRITE_VIA_CSHARP production
# when prompted for the value, enter exactly: true
```

Then trigger a new prod deployment so the env var takes effect (Vercel only picks up env var
changes on the _next_ build, not retroactively on the currently-running one) — e.g. `npx vercel
--prod`, or push/merge any commit to trigger the existing CI deploy, whichever this project
normally uses. Confirm the deployment reaches `● Ready`.

Re-run the request from §4a once against real prod (`https://<your-prod-domain>/api/trpc/...`)
with a **fresh** pending validation id and confirm the response still looks correct — this proves
the flag flip actually took effect and the C# path is now the one answering.

---

## 6. After this

- The flip itself is done — the C# path is now live for all vendor writes in prod.
- TS-deletion of the dark fallback (`external-validation.service.ts`'s TS branch,
  `external-validation.repository.ts`) is a **separate follow-up task**, same pattern as every
  other domain's TS-deletion pass — not covered by this doc, do after this flip has soaked for a
  bit.
- Tell Claude pass/fail per step in §4 (never the key value) if you want it to pick up the
  TS-deletion follow-up.
