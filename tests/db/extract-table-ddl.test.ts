/**
 * Tests for scripts/db/extract-table-ddl.mjs — issue #128.
 *
 * The one property that matters most and is easiest to get wrong: **attribution**. A FOREIGN KEY block
 * mentions two tables, and attributing it to the REFERENCES target instead of the ALTER TABLE target
 * would silently pull a stranger's constraint into an extraction — or silently drop the real one. So the
 * parser is tested against a hand-built dump whose shape mirrors real pg_dump output, plus against the
 * committed production baseline itself.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_REL,
  buildDdl,
  enumDepsOf,
  granteesOf,
  parseBlocks,
  sequenceOfAcl,
  tableOf,
} from '../../scripts/db/extract-table-ddl.mjs';

/** A miniature dump using pg_dump's real banner shape. */
const DUMP = `--
-- PostgreSQL database dump
--

SET statement_timeout = 0;

--
-- Name: MyStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."MyStatus" AS ENUM (
    'a',
    'b'
);

ALTER TYPE public."MyStatus" OWNER TO postgres;

--
-- Name: parent; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.parent (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    status public."MyStatus" NOT NULL
);

ALTER TABLE ONLY public.parent FORCE ROW LEVEL SECURITY;

ALTER TABLE public.parent OWNER TO postgres;

--
-- Name: other; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.other (
    id uuid NOT NULL
);

ALTER TABLE public.other OWNER TO postgres;

--
-- Name: parent parent_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.parent
    ADD CONSTRAINT parent_pkey PRIMARY KEY (id);

--
-- Name: parent_org_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX parent_org_idx ON public.parent USING btree (organization_id);

--
-- Name: parent; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.parent ENABLE ROW LEVEL SECURITY;

--
-- Name: parent tenant_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY tenant_isolation ON public.parent USING ((organization_id = '00000000-0000-0000-0000-000000000000'::uuid));

--
-- Name: TABLE parent; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT ON TABLE public.parent TO app_tenant;

--
-- Name: parent parent_other_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.parent
    ADD CONSTRAINT parent_other_id_fkey FOREIGN KEY (id) REFERENCES public.other(id) ON DELETE CASCADE;
`;

describe('parseBlocks', () => {
  it('finds every object block with its declared type', () => {
    const types = parseBlocks(DUMP).map((b) => b.type);
    expect(types).toEqual([
      'TYPE',
      'TABLE',
      'TABLE',
      'CONSTRAINT',
      'INDEX',
      'ROW SECURITY',
      'POLICY',
      'ACL',
      'FK CONSTRAINT',
    ]);
  });

  it("does not leak the next block's banner into the previous body", () => {
    // Regression: the lone `--` opening a banner was landing in the prior body and parsing as `--;`.
    for (const b of parseBlocks(DUMP)) {
      expect(b.body.trimEnd().endsWith('--')).toBe(false);
    }
  });

  it('skips the generated baseline header when the sentinel is present', () => {
    const withHeader = `-- TIMS ATS — production schema baseline\n-- Captured: whenever\n-- >>> END BASELINE HEADER — blah\n${DUMP}`;
    expect(parseBlocks(withHeader).length).toBe(parseBlocks(DUMP).length);
  });
});

describe('tableOf — attribution', () => {
  const blocks = parseBlocks(DUMP);
  const find = (type: string, match: string) => blocks.find((b) => b.type === type && b.name.includes(match))!;

  it('attributes a FOREIGN KEY to the ALTER TABLE target, NOT the REFERENCES target', () => {
    // The single most dangerous mis-attribution: this block names both `parent` and `other`.
    expect(tableOf(find('FK CONSTRAINT', 'fkey'))).toBe('parent');
  });

  it('attributes an INDEX via its ON clause, since the banner does not name the table', () => {
    expect(tableOf(find('INDEX', 'parent_org_idx'))).toBe('parent');
  });

  it('attributes tables, constraints, policies, RLS and ACL blocks', () => {
    expect(tableOf(find('TABLE', 'parent'))).toBe('parent');
    expect(tableOf(find('CONSTRAINT', 'parent_pkey'))).toBe('parent');
    expect(tableOf(find('POLICY', 'tenant_isolation'))).toBe('parent');
    expect(tableOf(find('ROW SECURITY', 'parent'))).toBe('parent');
    expect(tableOf(find('ACL', 'parent'))).toBe('parent');
  });

  it('returns null for blocks that are not table-scoped', () => {
    expect(tableOf(find('TYPE', 'MyStatus'))).toBeNull();
  });
});

describe('helpers', () => {
  it('enumDepsOf finds quoted public types', () => {
    expect(enumDepsOf('status public."MyStatus" NOT NULL')).toEqual(['"MyStatus"']);
  });

  it('enumDepsOf ignores unquoted public.table references', () => {
    expect(enumDepsOf('REFERENCES public.users(id)')).toEqual([]);
  });

  it('granteesOf extracts roles and skips PUBLIC', () => {
    expect(granteesOf('GRANT SELECT ON TABLE public.x TO app_tenant;')).toEqual(['app_tenant']);
    expect(granteesOf('GRANT SELECT ON TABLE public.x TO PUBLIC;')).toEqual([]);
  });
});

describe('buildDdl', () => {
  const { sql, warnings, found } = buildDdl(DUMP, ['parent']);

  it('emits only the requested table, not its FK neighbour', () => {
    expect(found).toEqual(['parent']);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.parent');
    expect(sql).not.toContain('CREATE TABLE IF NOT EXISTS public.other');
  });

  it('warns that an out-of-extraction FK target must exist first', () => {
    expect(warnings.join(' ')).toMatch(/reference tables NOT in this extraction: other/);
  });

  it('pulls in the enum the table depends on, guarded on pg_type', () => {
    expect(sql).toContain('CREATE TYPE public."MyStatus"');
    expect(sql).toMatch(/t\.typname = 'MyStatus'/);
  });

  it('never emits OWNER TO — it would fail on a dev DB with a different superuser', () => {
    expect(sql).not.toContain('OWNER TO');
  });

  it('makes tables and indexes idempotent', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS');
  });

  it('guards constraints on pg_constraint, since ADD CONSTRAINT has no IF NOT EXISTS', () => {
    expect(sql).toMatch(/conname = 'parent_pkey'[\s\S]*ADD CONSTRAINT parent_pkey/);
  });

  it('drops a policy before creating it, so re-running cannot fail or double up', () => {
    const dropAt = sql.indexOf('DROP POLICY IF EXISTS tenant_isolation');
    const createAt = sql.indexOf('CREATE POLICY tenant_isolation');
    expect(dropAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(dropAt);
  });

  it('guards GRANTs on the role existing', () => {
    expect(sql).toMatch(/pg_roles WHERE rolname = 'app_tenant'[\s\S]*GRANT SELECT,INSERT/);
  });

  it('emits FORCE ROW LEVEL SECURITY exactly once, after ENABLE', () => {
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(1);
    expect(sql.indexOf('ENABLE ROW LEVEL SECURITY')).toBeLessThan(sql.indexOf('FORCE ROW LEVEL SECURITY'));
  });

  it('puts foreign keys LAST so a multi-table extraction applies in any order', () => {
    expect(sql.indexOf('CREATE TABLE IF NOT EXISTS')).toBeLessThan(sql.indexOf('parent_other_id_fkey'));
    expect(sql.indexOf('CREATE INDEX IF NOT EXISTS')).toBeLessThan(sql.indexOf('parent_other_id_fkey'));
  });

  it('wraps everything in one transaction, so a partial apply cannot happen', () => {
    expect(sql.trimStart()).toMatch(/^-- GENERATED FILE/);
    expect(sql).toMatch(/\nBEGIN;/);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('says loudly that it must not be applied to production', () => {
    expect(sql).toMatch(/NEVER APPLY THIS TO PRODUCTION/);
  });

  it('reports a table that is not in the dump instead of silently emitting nothing', () => {
    expect(buildDdl(DUMP, ['nope']).warnings.join(' ')).toMatch(/table not found in baseline: nope/);
  });

  it('throws on input that is not a pg_dump', () => {
    expect(() => buildDdl('just some text', ['parent'])).toThrow(/no pg_dump object blocks/);
  });
});

describe('against the committed production baseline', () => {
  const dump = readFileSync(BASELINE_REL, 'utf8');

  it('parses every object class the real baseline contains', () => {
    const types = new Set(parseBlocks(dump).map((b) => b.type));
    for (const t of ['TABLE', 'INDEX', 'CONSTRAINT', 'FK CONSTRAINT', 'POLICY', 'ROW SECURITY', 'ACL', 'TYPE'])
      expect(types).toContain(t);
  });

  it('attributes every table-scoped block in public to a table (no silent drops)', () => {
    const tableScoped = ['TABLE', 'INDEX', 'CONSTRAINT', 'FK CONSTRAINT', 'POLICY', 'ROW SECURITY', 'ACL'];
    const blocks = parseBlocks(dump).filter(
      (b) =>
        tableScoped.includes(b.type) &&
        b.schema === 'public' &&
        // A SEQUENCE ACL is not table-scoped; it is resolved via the sequence→table mapping instead.
        !sequenceOfAcl(b),
    );
    expect(blocks.length).toBeGreaterThan(900); // sanity: the real baseline is ~1000 such blocks
    for (const b of blocks) expect(tableOf(b), `${b.type} / ${b.name}`).toBeTruthy();
  });

  it('carries a sequence ACL along with the table that owns the sequence', () => {
    // Regression: dropping this left app_tenant without USAGE on the sequence its column default
    // calls nextval() on, so inserts failed on a fresh dev database.
    const { sql } = buildDdl(dump, ['invoices']);
    expect(sql).toContain('CREATE SEQUENCE IF NOT EXISTS public.invoices_invoice_number_seq');
    expect(sql).toMatch(/ON SEQUENCE public\.invoices_invoice_number_seq TO app_tenant/);
  });

  it('refuses to attribute anything outside public — supabase_migrations is not a flip candidate', () => {
    const foreign = parseBlocks(dump).filter((b) => b.schema && b.schema !== 'public');
    expect(foreign.length).toBeGreaterThan(0); // the baseline does include supabase_migrations
    for (const b of foreign) expect(tableOf(b), `${b.schema}.${b.name}`).toBeNull();
    // And it must therefore be unextractable by name.
    expect(buildDdl(dump, ['schema_migrations']).warnings.join(' ')).toMatch(/table not found/);
  });

  /**
   * Every committed artifact must be exactly what the generator produces today — so a hand edit, or a
   * baseline re-capture that moved the schema, fails CI instead of drifting silently.
   *
   * Deliberately DISCOVERS the files rather than listing them: a hard-coded list would not cover the
   * artifact added by the next flip, which is precisely when this check matters. The table list is read
   * back out of each file's own `-- Regenerate:` line.
   */
  /**
   * Byte-identity is only half the guarantee. Auto-discovery means the suite iterates whatever files
   * happen to be present, so DELETING one is a fully green change — and each of these is the repo's
   * ONLY executable definition of tables that exist in production (§0 P8). They look like dead weight:
   * nothing imports them, no script applies them, no CI job references them.
   *
   * So the required set is pinned by name. Adding a flip means adding its entry here, in the same PR.
   *
   * `evaluation360.sql` (flip #67) is required on a slightly WEAKER premise than the other four, and the
   * message below is worded not to overstate it. Its three tables DO still have a `CREATE TABLE` in
   * `packages/db/prisma/migrations/20260713150000_add_evaluation360/migration.sql:8,22,36` — §0 P8 was
   * not live for that flip, the `access_reviews` situation rather than the `calibration_*` one. It is
   * still required, because the premise that matters is BOOTSTRAP REACHABILITY, not mere existence:
   * `prisma db push` is the documented post-clone step and it does not apply `migrations/` at all, so
   * post-flip a fresh dev database gets none of the three tables from either source. Measured on a
   * scratch cluster, not reasoned about. The extracted artifact is also the better of the two — read
   * from the committed prod baseline rather than from migration source (#111 proved those differ), and
   * idempotent, atomic, GRANT-complete and Supabase-guarded, none of which the migration is.
   */
  const REQUIRED_FLIP_DDL = [
    'surveys.sql',
    'compensation.sql',
    'succession.sql',
    'calibration.sql',
    'evaluation360.sql',
  ];

  it.each(REQUIRED_FLIP_DDL)('flip-DDL artifact %s exists (the bootstrap definition of its tables)', (name) => {
    const p = join('services/Tims.Platform/db/flip-ddl', name);
    expect(
      existsSync(p),
      `${p} is missing. It is how a freshly bootstrapped dev database gets the tables it covers: their\n` +
        `Prisma models were deleted by an ownership flip, and 'prisma db push' — the documented\n` +
        `post-clone step — creates neither them nor anything in packages/db/prisma/migrations/.\n` +
        `For four of these five it is also the repository's ONLY executable definition; evaluation360.sql\n` +
        `is the exception (its tables retain a CREATE TABLE in migrations/20260713150000_add_evaluation360)\n` +
        `and is required for reachability rather than uniqueness. If a flip was deliberately reverted,\n` +
        `remove the entry from REQUIRED_FLIP_DDL in the same commit and say so.`,
    ).toBe(true);
  });

  it('keeps every committed flip-DDL artifact byte-identical to generator output', () => {
    const dir = 'services/Tims.Platform/db/flip-ddl';
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
    // Discovery still drives the byte-check (a NEW flip is covered without editing this test), but it
    // can no longer pass on a shrinking set.
    expect(files.length).toBeGreaterThanOrEqual(REQUIRED_FLIP_DDL.length);

    const captured = /^-- Captured:\s*(.+)$/m.exec(dump)?.[1];
    const server = /^-- Server version:\s*(.+)$/m.exec(dump)?.[1];
    const sourceNote = [captured && `captured ${captured}`, server && `server ${server}`].filter(Boolean).join(', ');

    for (const f of files) {
      const path = join(dir, f);
      const contents = readFileSync(path, 'utf8');
      const cmd = /^-- Regenerate: node scripts\/db\/extract-table-ddl\.mjs (.+)$/m.exec(contents);
      expect(cmd, `${path} has no '-- Regenerate:' line — was it hand-written?`).toBeTruthy();
      const tables = cmd![1].trim().split(/\s+/);
      const { sql } = buildDdl(dump, tables, { sourceNote });
      expect(sql, `${path} is stale or hand-edited — regenerate: ${cmd![1]}`).toBe(contents);
    }
  });

  it('refuses to run the generated SQL against a Supabase-managed database', () => {
    // "Do not apply to production" as a comment is not a control; this makes it one.
    const { sql } = buildDdl(dump, ['surveys']);
    expect(sql).toMatch(/schema_name = 'supabase_migrations'/);
    expect(sql).toMatch(/RAISE EXCEPTION 'REFUSED/);
    // Inside the transaction, so a mistaken apply changes nothing.
    expect(sql.indexOf('BEGIN;')).toBeLessThan(sql.indexOf('RAISE EXCEPTION'));
  });

  it('rejects a table name that is not a plain identifier', () => {
    // Such a name would break out of the header comment and land as an executable line.
    expect(() => buildDdl(dump, ['surveys\nDROP TABLE users;'])).toThrow(/invalid table name/);
    expect(() => buildDdl(dump, ['a b'])).toThrow(/invalid table name/);
  });
});
