import { describe, it, expect } from 'vitest';
import { Prisma } from '@tims/db';

describe('HirePrediction schema', () => {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'HirePrediction');

  it('defines HirePrediction mapped to hire_predictions with the snapshot + FK fields', () => {
    expect(model).toBeDefined();
    expect(model!.dbName).toBe('hire_predictions');
    const fieldNames = model!.fields.map((f) => f.name);
    expect(fieldNames).toEqual(
      expect.arrayContaining([
        'id', 'organizationId', 'userId', 'candidateId', 'vacancyId', 'offerId',
        'applicationId', 'overallScore', 'breakdown', 'weights', 'isPartial',
        'fitCalculatedAt', 'predictionStatus', 'hiredById', 'capturedAt',
        'createdAt', 'updatedAt',
      ]),
    );
  });

  it('makes offerId unique and applicationId nullable', () => {
    const offerId = model!.fields.find((f) => f.name === 'offerId');
    const applicationId = model!.fields.find((f) => f.name === 'applicationId');
    const hiredById = model!.fields.find((f) => f.name === 'hiredById');
    expect(offerId!.isUnique).toBe(true);
    expect(applicationId!.isRequired).toBe(false);
    expect(hiredById!.isRequired).toBe(false);
  });

  it('types predictionStatus as the HirePredictionStatus enum', () => {
    const field = model!.fields.find((f) => f.name === 'predictionStatus');
    expect(field!.type).toBe('HirePredictionStatus');
    const enumDef = Prisma.dmmf.datamodel.enums.find((e) => e.name === 'HirePredictionStatus');
    expect(enumDef!.values.map((v) => v.name)).toEqual(['scored', 'partial', 'none']);
  });
});
