/**
 * The spec runs `docker exec … psql` against the suite database container named in the state file, so it must be
 * the one stack/up.sh started: `${CROSS_PREFIX}-suite-db` (suite-up.ts runs with PREFIX="$P-suite"). up.sh records
 * the prefix in the state file; any other container name is refused. A prefix is a plain Docker name fragment.
 */
const PREFIX_SHAPE = /^[a-z0-9][a-z0-9_.-]{0,62}$/;

export function isHarnessSuiteDb(container: unknown, prefix: unknown): boolean {
  return (
    typeof prefix === 'string' &&
    PREFIX_SHAPE.test(prefix) &&
    typeof container === 'string' &&
    container === `${prefix}-suite-db`
  );
}
