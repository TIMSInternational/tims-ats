import { describe, it, expect } from 'vitest';
import {
  dataClassOf,
  fieldsVisibleTo,
  CLASSIFICATION,
  DATA_CLASS_RANK,
} from '../../packages/api/src/access/classification';

describe('classification registry — data classes', () => {
  it('employeeCompensation is restricted', () => {
    expect(dataClassOf('employeeCompensation')).toBe('restricted');
  });
  it('assessmentResult.breakdown is restricted (psychometric raw)', () => {
    expect(CLASSIFICATION.assessmentResult.fields.breakdown.dataClass).toBe('restricted');
  });
  it('assessmentResult.normalizedScore is confidential (psychometric score)', () => {
    expect(CLASSIFICATION.assessmentResult.fields.normalizedScore.dataClass).toBe('confidential');
  });
  it('employeeDemographics is confidential', () => {
    expect(dataClassOf('employeeDemographics')).toBe('confidential');
  });
  it('surveyResponse.answers is confidential', () => {
    expect(CLASSIFICATION.surveyResponse.fields.answers.dataClass).toBe('confidential');
  });
  it('unknown entity defaults to "internal", not "public" (fail-closed)', () => {
    expect(dataClassOf('nonexistent_entity')).toBe('internal');
  });
  it('every entity dataClass is >= the max of its field dataClasses (monotonicity)', () => {
    for (const entity of Object.values(CLASSIFICATION)) {
      const maxField = Math.max(
        ...Object.values(entity.fields).map((f) => DATA_CLASS_RANK[f.dataClass]),
      );
      expect(DATA_CLASS_RANK[entity.dataClass]).toBeGreaterThanOrEqual(maxField);
    }
  });
});

describe('fieldsVisibleTo — fail-closed union across roles', () => {
  it('super_admin sees all compensation fields', () => {
    const f = fieldsVisibleTo(['super_admin'], 'employeeCompensation');
    expect(f).toContain('currentSalary');
    expect(f).toContain('compaRatio');
  });
  it('recruiter sees NO compensation fields (NONE in matrix)', () => {
    expect(fieldsVisibleTo(['recruiter'], 'employeeCompensation')).toEqual([]);
  });
  it('employee sees own-readable compensation fields but not compaRatio', () => {
    const f = fieldsVisibleTo(['employee'], 'employeeCompensation');
    expect(f).toContain('currentSalary');
    expect(f).not.toContain('compaRatio');
  });
  it('breakdown (raw psychometric) is visible ONLY to super_admin', () => {
    expect(fieldsVisibleTo(['super_admin'], 'assessmentResult')).toContain('breakdown');
    expect(fieldsVisibleTo(['hr_admin'], 'assessmentResult')).not.toContain('breakdown');
    expect(fieldsVisibleTo(['recruiter'], 'assessmentResult')).not.toContain('breakdown');
  });
  it('union: a user holding [recruiter, super_admin] gets the WIDER set (super_admin)', () => {
    expect(fieldsVisibleTo(['recruiter', 'super_admin'], 'assessmentResult')).toContain('breakdown');
  });
  it('unknown role contributes nothing (fail-closed)', () => {
    expect(fieldsVisibleTo(['nonexistent_role'], 'employeeCompensation')).toEqual([]);
  });
  it('empty roles → no fields (fail-closed)', () => {
    expect(fieldsVisibleTo([], 'employeeCompensation')).toEqual([]);
  });
});
