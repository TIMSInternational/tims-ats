import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toExternalValidationResultV1 } from '../../packages/api/src/dto/external-validation';

// Phase-5 Slice 2: the SAME golden fixtures asserted by the C# ExternalValidationResultV1.Map
// (contracts/external-fixtures/validation-result-v1.json) are asserted here against the REAL TS
// toExternalValidationResultV1. Proves the (id, status, completedAt) -> v1 map is byte-identical across
// stacks: constant schemaVersion 'v1', value passthrough, and the canonical `…fffZ` completedAt wire form
// (TS `.toISOString()` === C# NodeIsoDateTimeOffsetConverter).

interface InputRow {
  id: string;
  status: string;
  completedAt: string;
}
interface ExpectedV1 {
  schemaVersion: string;
  id: string;
  status: string;
  completedAt: string;
}

const data = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../contracts/external-fixtures/validation-result-v1.json', import.meta.url)),
    'utf8',
  ),
) as { description: string; cases: Array<{ name: string; input: InputRow; expected: ExpectedV1 }> };

describe('validation-result-v1.json — real toExternalValidationResultV1', () => {
  it.each(data.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const { input, expected } = c;

    const v1 = toExternalValidationResultV1({
      id: input.id,
      status: input.status,
      completedAt: new Date(input.completedAt),
    });

    expect(v1.schemaVersion).toBe(expected.schemaVersion);
    expect(v1.id).toBe(expected.id);
    expect(v1.status).toBe(expected.status);
    // The completedAt wire form must be the canonical `…fffZ` ISO string, byte-for-byte with the C# side.
    expect(v1.completedAt.toISOString()).toBe(expected.completedAt);
  });
});
