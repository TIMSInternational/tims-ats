import { describe, it, expect } from 'vitest';
import { Prisma } from '@tims/db';

describe('FIT Engine schema', () => {
  it('defines RoleFamilyWeightProfile with the expected fields and unique constraint', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'RoleFamilyWeightProfile');
    expect(model).toBeDefined();
    const fieldNames = model!.fields.map((f) => f.name);
    expect(fieldNames).toEqual(
      expect.arrayContaining(['id', 'organizationId', 'name', 'weights', 'createdAt', 'updatedAt']),
    );
    expect(model!.uniqueFields).toContainEqual(['organizationId', 'name']);
  });

  it('adds roleFamily to Vacancy', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Vacancy');
    const field = model!.fields.find((f) => f.name === 'roleFamily');
    expect(field).toBeDefined();
    expect(field!.isRequired).toBe(false);
    expect(field!.type).toBe('String');
  });

  it('adds education and languages to Candidate', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'Candidate');
    const education = model!.fields.find((f) => f.name === 'education');
    const languages = model!.fields.find((f) => f.name === 'languages');
    expect(education).toBeDefined();
    expect(education!.type).toBe('Json');
    expect(education!.isRequired).toBe(false);
    expect(languages).toBeDefined();
    expect(languages!.type).toBe('Json');
    expect(languages!.isRequired).toBe(false);
  });
});
