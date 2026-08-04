/**
 * Tests for scripts/db/extract-table-ddl.mjs — issue #128.
 *
 * The one property that matters most and is easiest to get wrong: **attribution**. A FOREIGN KEY block
 * mentions two tables, and attributing it to the REFERENCES target instead of the ALTER TABLE target
 * would silently pull a stranger's constraint into an extraction — or silently drop the real one. So the
 * parser is tested against a hand-built dump whose shape mirrors real pg_dump output, plus against the
 * committed production baseline itself.
 */
import { readFileSync } from 'node:fs';
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

  it('extracts the two committed flip-DDL artifacts byte-identically (they are generated, not edited)', () => {
    for (const [file, tables] of [
      ['services/Tims.Platform/db/flip-ddl/surveys.sql', ['surveys', 'survey_responses']],
      ['services/Tims.Platform/db/flip-ddl/compensation.sql', ['salary_adjustments', 'employee_compensations']],
    ] as const) {
      const captured = /^-- Captured:\s*(.+)$/m.exec(dump)?.[1];
      const server = /^-- Server version:\s*(.+)$/m.exec(dump)?.[1];
      const { sql } = buildDdl(dump, [...tables], {
        sourceNote: [captured && `captured ${captured}`, server && `server ${server}`].filter(Boolean).join(', '),
      });
      expect(sql, `${file} is stale — regenerate it`).toBe(readFileSync(file, 'utf8'));
    }
  });
});
