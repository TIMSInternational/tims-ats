import { spawnSync } from 'node:child_process';

// Parses a YAML file with python3 + PyYAML (present on GitHub's ubuntu runners and used by the other
// python3-backed governance tests' toolchain). A JS YAML parser is deliberately NOT imported: none is a
// declared dependency of the root package, and reaching into an undeclared transitive dep is a defect
// this repo has already been bitten by (see ci-triggers.test.ts).
//
// Fails LOUDLY when PyYAML is unavailable — a governance check that silently skips is not a check.
export function parseYaml(path: string): unknown {
  const result = spawnSync(
    'python3',
    ['-c', 'import json, sys, yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1])), default=str))', path],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`YAML parse failed for ${path} (is python3 PyYAML installed?):\n${result.stderr}`);
  }
  return JSON.parse(result.stdout) as unknown;
}
