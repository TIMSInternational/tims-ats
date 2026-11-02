/**
 * Renders the pure-SQL "apply via connector" variant of a psql backfill script.
 *
 * The psql scripts in this directory are the reviewed source of truth. Their apply section sits
 * between `-- CONNECTOR-APPLY-BEGIN` and `-- CONNECTOR-APPLY-END`, and uses psql only for:
 *   - `\o` / `\echo` lines (output plumbing) — dropped here;
 *   - `:'name'` variable interpolation — replaced here with a literal from CONNECTOR_INPUTS.
 * Everything else (BEGIN, guards, assertions, COMMIT, read-back) is copied byte for byte, so the
 * connector file cannot drift from the psql script: tests/db/backfill-defaults-pinned.test.ts renders
 * every file again and asserts it equals the committed one.
 *
 * Regenerate after editing a psql script or CONNECTOR_INPUTS:
 *   npx tsx scripts/db/backfills/generate-connector-applies.ts
 */

/** The production dry run the inlined totals come from. */
export const CONNECTOR_DRY_RUN_DATE = '2026-10-01';

/**
 * psql variables per script, inlined as literals. Only `true` / `false` / non-negative integers are
 * accepted, so nothing here can inject SQL.
 */
export const CONNECTOR_INPUTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '288-org-roles-and-grants': { expected_orgs: '1' },
  '319-onboarding-default-tasks': {
    include_past_day90: 'false',
    expected_empty_plans: '0',
    expected_undated_tasks: '0',
  },
  '320-org-structure-defaults': { expected_orgs: '11' },
};

const BEGIN_MARKER = '-- CONNECTOR-APPLY-BEGIN';
const END_MARKER = '-- CONNECTOR-APPLY-END';
const ALLOWED_META = /^\\(o|echo)\b/;
const VALUE = /^(true|false|\d+)$/;

export function renderConnectorApply(
  name: string,
  psqlSource: string,
  inputs: Readonly<Record<string, string>>,
): string {
  const lines = psqlSource.split('\n');
  const begin = lines.indexOf(BEGIN_MARKER);
  const end = lines.indexOf(END_MARKER);
  if (begin < 0 || end < 0 || end <= begin) throw new Error(`${name}: CONNECTOR-APPLY markers missing or out of order`);
  if (lines.lastIndexOf(BEGIN_MARKER) !== begin || lines.lastIndexOf(END_MARKER) !== end) {
    throw new Error(`${name}: CONNECTOR-APPLY markers must appear exactly once`);
  }

  for (const [key, value] of Object.entries(inputs)) {
    if (!VALUE.test(value)) throw new Error(`${name}: input ${key}=${value} is not true/false/integer`);
  }

  const used = new Set<string>();
  const body: string[] = [];
  for (const line of lines.slice(begin + 1, end)) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('\\')) {
      if (!ALLOWED_META.test(trimmed)) throw new Error(`${name}: unsupported psql meta-command: ${trimmed}`);
      continue;
    }
    body.push(
      line.replace(/:'([a-z_][a-z0-9_]*)'/g, (_match, variable: string) => {
        const value = inputs[variable];
        if (value === undefined) throw new Error(`${name}: no CONNECTOR_INPUTS value for :'${variable}'`);
        used.add(variable);
        return `'${value}'`;
      }),
    );
  }

  const unused = Object.keys(inputs).filter((key) => !used.has(key));
  if (unused.length > 0)
    throw new Error(`${name}: CONNECTOR_INPUTS not referenced by the script: ${unused.join(', ')}`);
  const rendered = body.join('\n');
  if (/:'[a-z_]|:\{\?|:"[a-z_]+"/.test(rendered.replace(/\$grants\$[\s\S]*?\$grants\$/g, ''))) {
    throw new Error(`${name}: psql variable syntax left in the rendered SQL`);
  }

  const header = [
    `-- GENERATED FILE - do not edit. Source: scripts/db/backfills/${name}.sql (its CONNECTOR-APPLY section).`,
    '-- Regenerate: npx tsx scripts/db/backfills/generate-connector-applies.ts',
    '--',
    '-- Pure SQL for a connector that cannot run psql meta-commands: the same single transaction, guards',
    '-- and assertions as the psql apply, with its psql variables inlined from the production dry run of',
    `-- ${CONNECTOR_DRY_RUN_DATE}:`,
    ...Object.entries(inputs).map(([key, value]) => `--   ${key} = ${value}`),
    '-- Re-run the dry run first. If its totals differ, update CONNECTOR_INPUTS in connector-apply.ts and',
    '-- regenerate; otherwise the apply aborts on the dry-run guard and nothing is written.',
    '-- Send the WHOLE file as ONE request, as a BYPASSRLS role (postgres): the guard aborts otherwise.',
    '',
  ];
  return `${header.join('\n')}${rendered}\n`;
}
