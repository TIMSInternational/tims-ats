/**
 * One-time backfill for the B2 invite-time-linking migration.
 *
 * Before B2, invited staff `User` rows were created with an unclaimed sentinel
 * (`supabaseUserId: ''` from user.create, or `pending-<candidateId>` from employee
 * conversion) and linked later by an ambient email match. B2 removes that email
 * join, so any PRE-EXISTING unclaimed row would be stranded (can never link). This
 * script links them the same way new rows are linked: reuse the existing Supabase
 * auth identity for the email if one exists, otherwise invite a fresh one.
 *
 * Safe by default: DRY-RUN (prints what it would do). Pass --apply to write.
 *
 *   pnpm --filter @tims/api exec tsx scripts/backfill-staff-supabase-links.ts
 *   pnpm --filter @tims/api exec tsx scripts/backfill-staff-supabase-links.ts --apply
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment.
 */
import { db } from '@tims/db';
import { getAppUrl } from '@tims/shared';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
  // --apply sends invite emails whose links embed the app URL. Refuse to fall back
  // to the canonical prod default here: this script may be run against staging/local,
  // and a prod link would point invitees at the wrong Supabase project AFTER we've
  // already written their supabaseUserId. Require it explicitly for writes.
  if (APPLY && !process.env.NEXT_PUBLIC_APP_URL?.trim()) {
    throw new Error('NEXT_PUBLIC_APP_URL must be set explicitly for --apply (invite links embed it; refusing to default to production to avoid wrong-environment onboarding)');
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const appUrl = getAppUrl();

  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`App URL: ${appUrl}`);

  // PASS 1 — tombstone legacy artifacts FIRST. These are org-less, non-owner rows
  // that already hold a real Supabase id (minted by the now-removed register-
  // candidate flow). They are not usable staff identities yet they hold globally-
  // unique auth ids that would BLOCK linking a real staff row in pass 2. Tombstoning
  // them first (soft-delete + unlink) frees those ids. Must run before pass 2 — a
  // staff row whose email resolves to a legacy-owned id only links once the blocker
  // is cleared. Candidates use the careers-portal magic link, not a `User` row, so
  // this removes only dead artifacts.
  // NOTE: no deletedAt filter — a legacy row that was ALREADY soft-deleted can still
  // hold a real supabaseUserId (global @unique) and would otherwise keep blocking a
  // staff relink. Tombstoning it (renaming the id) is what actually frees the id.
  const legacy = await db.user.findMany({
    where: {
      organizationId: null,
      isPlatformOwner: false,
      NOT: [
        { supabaseUserId: '' },
        { supabaseUserId: { startsWith: 'pending-' } },
        { supabaseUserId: { startsWith: 'tombstone-' } },
      ],
    },
    select: { id: true, email: true },
  });
  console.log(`\nPASS 1 — ${legacy.length} legacy org-less candidate row(s) to tombstone:`);
  let tombstoned = 0;
  for (const row of legacy) {
    console.log(`  tombstone ${row.email} (${row.id})`);
    if (!APPLY) continue;
    await db.user.update({
      where: { id: row.id },
      data: { supabaseUserId: `tombstone-${row.id}`, isActive: false, deletedAt: new Date() },
    });
    tombstoned++;
  }

  // PASS 2 — link unclaimed sentinels: '' (user.create) or 'pending-%' (employee
  // conversion). After pass 1, any auth id is owned only by a REAL staff row (a
  // genuine conflict) — never a legacy artifact.
  // Only ACTIVE, undeleted, org-scoped sentinel rows are linked. A deactivated or
  // soft-deleted invite (its supabaseUserId is left untouched on deactivate) must NOT
  // trigger a fresh inviteUserByEmail to a former/cancelled user.
  const unclaimed = await db.user.findMany({
    where: {
      AND: [
        { OR: [{ supabaseUserId: '' }, { supabaseUserId: { startsWith: 'pending-' } }] },
        { isActive: true },
        { deletedAt: null },
        { organizationId: { not: null } },
      ],
    },
    select: { id: true, email: true, supabaseUserId: true, organizationId: true },
  });
  console.log(`\nPASS 2 — ${unclaimed.length} active unclaimed staff row(s) to link:`);

  let linked = 0;
  let invited = 0;
  let skipped = 0;
  let conflicts = 0;
  // Track auth ids consumed this run so two unclaimed rows can't both grab the same
  // identity (would violate User.supabaseUserId @unique on the second update).
  const usedThisRun = new Set<string>();

  for (const user of unclaimed) {
    if (!user.email) {
      console.warn(`  SKIP ${user.id}: no email`);
      skipped++;
      continue;
    }

    // Reuse an existing Supabase identity for this email if present.
    const existing = await db.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM auth.users WHERE lower(email) = lower(${user.email}) LIMIT 1
    `;
    let supabaseUserId: string | null = existing[0]?.id ?? null;

    // Owner handling (legacy-aware): an id already consumed this run, or owned by a
    // DIFFERENT REAL staff row (org-scoped or platform owner), is a genuine conflict
    // — report + skip. A DIFFERENT non-real owner (legacy org-less non-owner, in ANY
    // state incl. already soft-deleted) is reclaimed inline — tombstone it to free
    // the globally-unique id (same as the runtime resolver). This is the backstop for
    // any legacy blocker pass 1 didn't already clear.
    if (supabaseUserId) {
      if (usedThisRun.has(supabaseUserId)) {
        console.warn(`  CONFLICT ${user.email}: auth id ${supabaseUserId} used earlier this run — SKIP`);
        conflicts++;
        continue;
      }
      const owner = await db.user.findUnique({
        where: { supabaseUserId },
        select: { id: true, organizationId: true, isPlatformOwner: true },
      });
      if (owner && owner.id !== user.id) {
        if (owner.isPlatformOwner || owner.organizationId) {
          console.warn(`  CONFLICT ${user.email}: auth id owned by another staff user — SKIP`);
          conflicts++;
          continue;
        }
        console.log(`  reclaim legacy owner of ${user.email}'s auth id (${owner.id})`);
        if (APPLY) {
          await db.user.update({
            where: { id: owner.id },
            data: { supabaseUserId: `tombstone-${owner.id}`, isActive: false, deletedAt: new Date() },
          });
        }
      }
    }

    const action = supabaseUserId ? 'link (existing auth user)' : 'invite (new auth user)';
    console.log(`  ${user.email} [org ${user.organizationId ?? '—'}] → ${action}`);

    if (!APPLY) continue;

    if (!supabaseUserId) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(user.email, {
        redirectTo: `${appUrl}/auth/callback`,
      });
      if (error || !data?.user?.id) {
        console.error(`    FAILED to invite ${user.email}: ${error?.message ?? 'no id'}`);
        skipped++;
        continue;
      }
      supabaseUserId = data.user.id;
      invited++;
    } else {
      linked++;
    }

    try {
      await db.user.update({ where: { id: user.id }, data: { supabaseUserId } });
      usedThisRun.add(supabaseUserId);
    } catch (err) {
      // Most likely a P2002 race on the global unique — report and continue rather
      // than abort the whole backfill mid-way.
      console.error(`    FAILED to link ${user.email}: ${(err as Error).message}`);
      conflicts++;
    }
  }

  console.log(
    `\nDone. ${APPLY ? `tombstoned=${tombstoned} linked=${linked} invited=${invited} conflicts=${conflicts} skipped=${skipped}` : `dry-run — legacy=${legacy.length}, conflicts=${conflicts}; re-run with --apply to write`}`,
  );
  if (conflicts > 0) {
    console.warn(`\n⚠ ${conflicts} row(s) need manual resolution (auth id owned by another REAL staff row).`);
  }

  // Fail closed: under id-only recognition, any active staff row left unlinked after
  // --apply cannot authenticate. A deploy runner must NOT treat a run with leftover
  // conflicts/skips as a success. (Dry-run always exits 0 — it's informational.)
  if (APPLY && (conflicts > 0 || skipped > 0)) {
    console.error(
      `\n✖ Migration INCOMPLETE: ${conflicts} conflict(s) + ${skipped} skipped row(s) unresolved. Resolve manually and re-run before enabling id-only recognition.`,
    );
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
