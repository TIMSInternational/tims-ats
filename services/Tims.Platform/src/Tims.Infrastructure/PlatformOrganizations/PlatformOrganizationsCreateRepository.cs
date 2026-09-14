using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Application.PlatformOrganizations;
using Tims.Infrastructure.Audit;
using Tims.Infrastructure.OrgProvisioning;

namespace Tims.Infrastructure.PlatformOrganizations;

/// <summary>
/// The platform-owner organization CREATE repository (Phase-5 slice 21, issue #76) — the C# port of
/// <c>createOrganization</c> (<c>routers/platform/organizations.ts:149-242</c>).
///
/// <para><b>SEVEN tables and the audit row are ONE transaction.</b> The TS wraps seven writes in
/// <c>db.$transaction</c> (<c>:113-147</c>); this port opens a <see cref="TenantScope"/> on the NEW
/// organization id, issues all seven, adds the <c>audit_logs</c> row, <c>SaveChanges</c>, reads the created
/// row back and only then commits. If ANY of them fails — including the audit INSERT — the scope disposes
/// without committing and nothing at all is written. That is the fail-CLOSED contract from #76, and it is
/// what distinguishes this port from the TS <c>.catch(() =&gt; {})</c> at <c>:166</c>. Proved by mutation in
/// <c>PlatformOrganizationsCreateRepositoryTests</c>, in both directions.</para>
///
/// <para><b>Statement order reproduces the TS exactly</b> (<c>organizations.ts:184-218</c> +
/// <c>org-provisioning.ts:18-31</c>): organizations → companies → business_units → teams →
/// plan_modules SELECT → org_entitlements → roles → subscriptions → audit_logs. Only the chain
/// organizations → companies → business_units → teams is FK-forced; <c>roles</c> and <c>subscriptions</c>
/// are independent of it. The TS order is reproduced anyway, because it is the order a
/// <c>created_at</c>/<c>activated_at</c> skew would reveal and because a step-5 parity diff on a reordered
/// port is uninterpretable.</para>
///
/// <para><b>Raw SQL ONLY where a native Postgres enum leaves no choice</b> — <c>organizations.plan</c> and
/// <c>subscriptions.plan</c>/<c>status</c>. Everything else goes through EF, and that is a governance
/// decision, not a style one: <c>scripts/table-ownership.mjs</c> greps table names out of <c>ToTable</c> calls and nothing
/// else, so a raw-SQL writer is invisible to it (issue #199). Mapping the six provisioned tables through EF
/// is the only reason this slice's ledger entries for <c>org_entitlements</c> and <c>plan_modules</c> will
/// actually hard-fail CI if forgotten.</para>
/// </summary>
public sealed class PlatformOrganizationsCreateRepository(PlatformOrganizationsCreateDbContext db)
    : IPlatformOrganizationsCreateRepository
{
    private const string OrganizationEntity = "organization";
    private const string CreatedAction = "org_created";

    /// <summary>The Prisma unique index on <c>organizations.slug</c>. Matched by NAME — see <see cref="IsSlugConflict"/>.</summary>
    private const string SlugConstraintName = "organizations_slug_key";

    // organizations.ts:205 — `{ name: 'Super Administrador', slug: 'super_admin', isSystem: true }`.
    private const string SuperAdminRoleName = "Super Administrador";
    private const string SuperAdminRoleSlug = "super_admin";

    private readonly PlatformOrganizationsCreateDbContext _db = db;

    public async Task<CreateOrganizationResult> CreateAsync(
        PlatformOrganizationCreateInput input,
        string changesJson,
        Guid actorId,
        DateTime now,
        CancellationToken cancellationToken)
    {
        // Generated BEFORE the scope, and mandatory twice over. (1) None of the seven tables has a DB default
        // for `id` — Prisma's @default(uuid()) is client-side — so an INSERT that omits it fails 23502.
        // (2) TenantScope needs it before the first statement: BeginAsync(db, null) sets the GUC to '',
        // NULLIF(...,'')::uuid evaluates NULL, and every policy predicate fails closed.
        var organizationId = Guid.NewGuid();

        // MANDATORY, and invisible to every unit test. The use case supplies
        // `timeProvider.GetUtcNow().UtcDateTime`, whose Kind is Utc, and five of this transaction's tables
        // are written through EF into `timestamp WITHOUT time zone` columns. Npgsql refuses that pairing
        // outright — "Cannot write DateTime with Kind=UTC to PostgreSQL type 'timestamp without time zone'"
        // — so the whole create would 500 on its first EF INSERT in production while every unit test stayed
        // green. Normalising at the persistence boundary is the house pattern
        // (SuccessionWriteRepository.cs:310, EngagementWriteRepository.cs:365,
        // ExternalValidationRepository.cs:57). It changes no value, only the Kind tag.
        now = ToPostgresTimestamp(now);

        var name = input.Name;
        var slug = input.Slug;
        var plan = input.Plan;
        var billingEmail = PlatformOrganizationsCreateUseCase.ResolveBillingEmail(input);
        var updatedAt = ToTimestampText(now);

        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken).ConfigureAwait(false);

        PlatformOrganizationRow row;

        try
        {
            // 1. organizations. Raw-but-fully-parameterized: `plan` is a native Postgres enum (OrgPlan) with
            // no EF store mapping to write back through, so the text parameter is cast explicitly — the same
            // technique slice 20's UPDATE and BillingWebhookRepository already use on this column.
            // EnableUnmappedTypes does NOT help here: it makes Npgsql READ an unmapped enum as text, it
            // cannot bind text INTO an enum column.
            //
            // Timestamps bind as text + ::timestamp because a raw command carries no column-type hint, so
            // Npgsql would default a DateTime to timestamptz and Postgres would reject it against
            // `timestamp without time zone`.
            //
            // `settings`, `is_active`, `created_at`, `domain`, `logo`, `deleted_at` are deliberately ABSENT
            // from the column list — the TS `organization.create` sets none of them, and the DB
            // defaults/NULLs are the parity target.
            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 INSERT INTO organizations (id, name, slug, plan, billing_email, updated_at)
                 VALUES ({organizationId}, {name}, {slug}, {plan}::"OrgPlan", {billingEmail}, {updatedAt}::timestamp)
                 """,
                cancellationToken).ConfigureAwait(false);

            // 2-4. companies -> business_units -> teams (org-provisioning.ts:13-34).
            await OrgProvisioningWriter.ProvisionDefaultsAsync(_db, organizationId, input.Name, now, cancellationToken)
                .ConfigureAwait(false);

            // 5-6. SELECT plan_modules where plan_code = 'ats-base', then N x org_entitlements
            // (org-provisioning.ts:47-67). N = 0 is a valid outcome and commits — see the writer's remarks.
            await OrgProvisioningWriter.ProvisionEntitlementsAsync(_db, organizationId, now, cancellationToken)
                .ConfigureAwait(false);

            // 7. roles (organizations.ts:204-206). `description` stays NULL and `is_active` keeps its DB
            // default; no role_permissions and no user_roles rows are created, matching the TS exactly.
            _db.Roles.Add(new RoleWriteEntity
            {
                Id = Guid.NewGuid(),
                OrganizationId = organizationId,
                Name = SuperAdminRoleName,
                Slug = SuperAdminRoleSlug,
                IsSystem = true,
                UpdatedAt = now,
            });
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

            // 8. subscriptions (organizations.ts:208-215). TWO native enums this time: OrgPlan and
            // SubscriptionStatus. `trial_ends_at` binds as nullable text through the same ::timestamp cast.
            // Stripe columns and the period columns are never sent.
            var status = PlatformOrganizationsCreateUseCase.ResolveSubscriptionStatus(plan);
            var trialEndsAt = PlatformOrganizationsCreateUseCase.ResolveTrialEndsAt(plan, now);
            var trialEndsAtText = trialEndsAt is null ? null : ToTimestampText(trialEndsAt.Value);
            var subscriptionId = Guid.NewGuid();

            await _db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                 INSERT INTO subscriptions (id, organization_id, plan, status, trial_ends_at, updated_at)
                 VALUES ({subscriptionId}, {organizationId}, {plan}::"OrgPlan", {status}::"SubscriptionStatus",
                         {trialEndsAtText}::timestamp, {updatedAt}::timestamp)
                 """,
                cancellationToken).ConfigureAwait(false);

            // 9. The FAIL-CLOSED audit row, INSIDE the scope's transaction. TS writes this AFTER the
            // transaction with `.catch(() => {})` (organizations.ts:228-239); here a failure rolls the whole
            // seven-table creation back. Federico's decision on #76, already shipped for update/suspend.
            AddAuditRow(organizationId, actorId, changesJson);
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

            // The TS `organization.create` carries no `select:`, so it resolves to the full row. Reading it
            // back needs EnableUnmappedTypes on the data source (organizations.plan is a native enum).
            var created = await ReadRowAsync(organizationId, cancellationToken).ConfigureAwait(false);
            row = created ?? throw new InvalidOperationException(
                "the organization row disappeared inside its own creation transaction");
        }
        catch (Exception ex) when (IsSlugConflict(ex))
        {
            // DELIBERATE DIVERGENCE (2) in
            // docs/architecture/csharp-migration/phase-5-slice-21-platform-organizations-create.md:
            // TS has no P2002 handling anywhere in
            // organizations.ts, trpc.ts:17-19's errorFormatter is a pass-through and there is no Prisma-error
            // interceptor, so a duplicate slug leaks raw Prisma text as a 500 into the operator's modal
            // (create-org-modal.tsx:93-97). The house precedent for improving that is
            // SuccessionWriteRepository.cs:129-134. Returning here without committing means NOTHING is
            // written, including the audit row. No pre-existence check is added — .claude/rules/db.md bans
            // check-then-create; the constraint is the authority.
            return new CreateOrganizationResult(CreateOrganizationOutcome.SlugTaken, Row: null);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new CreateOrganizationResult(CreateOrganizationOutcome.Created, row);
    }

    public Task NotifyPlatformOwnersAsync(PlatformOwnerNotification notification, CancellationToken cancellationToken) =>
        PlatformOwnerNotifier.SendAsync(_db, _db.Users, _db.Notifications, notification, cancellationToken);

    /// <summary>
    /// <b>Codex M2 discipline: match ONLY <c>organizations_slug_key</c>.</b> A future or unexpected unique
    /// index, or a primary-key collision on the client-generated uuid, must NOT be mislabeled as the
    /// documented duplicate-slug 409 — it must propagate.
    ///
    /// <para>Both exception shapes are needed because this slice writes through two mechanisms: the raw
    /// <c>ExecuteSqlInterpolatedAsync</c> statements surface a <see cref="PostgresException"/> directly,
    /// while the EF <c>SaveChangesAsync</c> calls wrap it in a <see cref="DbUpdateException"/>. (Only the
    /// former can actually raise this constraint today — <c>slug</c> is written by statement 1 — but
    /// matching both is what keeps that true if the INSERT is ever moved.)</para>
    /// </summary>
    private static bool IsSlugConflict(Exception ex) =>
        ex is DbUpdateException
        {
            InnerException: PostgresException
            {
                SqlState: PostgresErrorCodes.UniqueViolation,
                ConstraintName: SlugConstraintName,
            },
        }
        || ex is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: SlugConstraintName,
        };

    private void AddAuditRow(Guid organizationId, Guid actorId, string changesJson) =>
        _db.AuditLogs.Add(new AuditLogEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = organizationId,
            // organizations.ts:232 — `ctx.user.id`, the `users.id` uuid, NOT supabaseUserId.
            ActorId = actorId,
            Action = CreatedAction,
            Entity = OrganizationEntity,
            // Prisma `entityId String?` is TEXT, not uuid — the TS passes the same uuid string.
            EntityId = organizationId.ToString(),
            Changes = ToJsonStringScalar(changesJson),
            // user_id / metadata / ip_address / user_agent are never set; created_at is the DB default.
        });

    private async Task<PlatformOrganizationRow?> ReadRowAsync(Guid id, CancellationToken cancellationToken)
    {
        var entity = await _db.Organizations
            .AsNoTracking()
            .FirstOrDefaultAsync(o => o.Id == id, cancellationToken)
            .ConfigureAwait(false);

        return entity is null ? null : Map(entity);
    }

    /// <summary>
    /// The TS <c>return org</c> is the full row <c>db.organization.create()</c> resolves to (no
    /// <c>select:</c> at <c>organizations.ts:185-192</c>). Field order follows the Prisma model declaration
    /// order so the JSON shape matches — identical to slice 20's <c>Map</c>, on the same record type.
    /// </summary>
    private static PlatformOrganizationRow Map(PlatformOrganizationWriteEntity entity) =>
        new(
            entity.Id.ToString(),
            entity.Name,
            entity.Slug,
            entity.Domain,
            entity.Logo,
            entity.Plan,
            entity.Settings is null ? null : JsonNode.Parse(entity.Settings),
            entity.BillingEmail,
            entity.IsActive,
            entity.CreatedAt,
            entity.UpdatedAt,
            entity.DeletedAt);

    /// <summary>
    /// Wraps the changes text as a JSON string VALUE, so the jsonb column receives a string SCALAR rather
    /// than an object — which is what Prisma stores, because <c>audit_logs.changes</c> is a <c>Json?</c>
    /// field handed <c>JSON.stringify(...)</c>. The escaping of the wrapper itself is irrelevant (Postgres
    /// decodes it before storing), which is why this uses the DEFAULT encoder while
    /// <see cref="PlatformOrganizationsCreateUseCase.BuildCreateChangesJson"/> must not: there, the escaping
    /// IS the stored content.
    /// </summary>
    private static string ToJsonStringScalar(string changesJson) => JsonSerializer.Serialize(changesJson);

    // Prisma writes `timestamp(3) without time zone` holding a UTC wall-clock; bind the same text form.
    private static string ToTimestampText(DateTime value) =>
        value.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture);

    /// <summary>
    /// Strips the <c>Kind=Utc</c> tag (and only the tag) so EF can bind the value to a
    /// <c>timestamp without time zone</c> column. The instant is unchanged; the column already holds a UTC
    /// wall-clock by Prisma's own convention. See the call site for why this is not optional.
    /// </summary>
    private static DateTime ToPostgresTimestamp(DateTime value) =>
        DateTime.SpecifyKind(value, DateTimeKind.Unspecified);
}
