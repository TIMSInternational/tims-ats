import { describe, it, expect } from 'vitest';
import { Prisma } from '@tims/db';

describe('AiInterviewSession schema', () => {
  it('AiInterviewSession is a known Prisma model with the expected fields', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'AiInterviewSession');
    expect(model, 'AiInterviewSession model exists').toBeTruthy();
    const fields = model!.fields.map((f) => f.name);
    for (const f of [
      'organizationId',
      'interviewId',
      'candidateId',
      'status',
      'guideQuestions',
      'transcript',
      'consentedAt',
      'analysisStatus',
      'fitScore',
      'candidateToken',
    ])
      expect(fields, f).toContain(f);
  });

  it('AiInterviewStatus enum has the expected values', () => {
    const enumDef = Prisma.dmmf.datamodel.enums.find((e) => e.name === 'AiInterviewStatus');
    expect(enumDef, 'AiInterviewStatus enum exists').toBeTruthy();
    const values = enumDef!.values.map((v) => v.name);
    for (const v of ['pending', 'in_progress', 'completed', 'failed', 'expired'])
      expect(values, v).toContain(v);
  });

  it('AiAnalysisStatus enum has the expected values', () => {
    const enumDef = Prisma.dmmf.datamodel.enums.find((e) => e.name === 'AiAnalysisStatus');
    expect(enumDef, 'AiAnalysisStatus enum exists').toBeTruthy();
    const values = enumDef!.values.map((v) => v.name);
    for (const v of ['pending', 'completed', 'failed'])
      expect(values, v).toContain(v);
  });

  it('interviewId is unique on AiInterviewSession', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'AiInterviewSession');
    const field = model!.fields.find((f) => f.name === 'interviewId');
    expect(field?.isUnique, 'interviewId should be unique').toBe(true);
  });

  it('candidateToken is unique on AiInterviewSession', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'AiInterviewSession');
    const field = model!.fields.find((f) => f.name === 'candidateToken');
    expect(field, 'candidateToken field exists').toBeTruthy();
    expect(field?.isUnique, 'candidateToken should be unique').toBe(true);
  });
});
