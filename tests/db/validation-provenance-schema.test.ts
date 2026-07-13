import { describe, it, expect } from 'vitest';
import { Prisma } from '@tims/db';

describe('PreemploymentValidation vendor provenance', () => {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'PreemploymentValidation');
  it('adds a nullable completedByApiKeyId + relation', () => {
    const field = model!.fields.find((f) => f.name === 'completedByApiKeyId');
    expect(field).toBeDefined();
    expect(field!.isRequired).toBe(false);
    expect(model!.fields.some((f) => f.name === 'completedByApiKey' && f.type === 'ApiKey')).toBe(true);
  });
});
