import { describe, it, expect } from 'vitest';
import { selectFor } from '../../packages/api/src/access/select-for';

describe('selectFor — builds a Prisma select from visible fields', () => {
  it('always includes id + organizationId + userId (non-sensitive anchors)', () => {
    const sel = selectFor(['super_admin'], 'employeeCompensation');
    expect(sel.id).toBe(true);
    expect(sel.organizationId).toBe(true);
    expect(sel.userId).toBe(true);
  });
  it('super_admin compensation select includes currentSalary + compaRatio', () => {
    const sel = selectFor(['super_admin'], 'employeeCompensation');
    expect(sel.currentSalary).toBe(true);
    expect(sel.compaRatio).toBe(true);
  });
  it('recruiter compensation select has NO sensitive fields (only anchors)', () => {
    const sel = selectFor(['recruiter'], 'employeeCompensation');
    expect(sel.currentSalary).toBeUndefined();
    expect(sel.compaRatio).toBeUndefined();
    expect(sel.id).toBe(true);
  });
  it('employee compensation select omits compaRatio', () => {
    const sel = selectFor(['employee'], 'employeeCompensation');
    expect(sel.currentSalary).toBe(true);
    expect(sel.compaRatio).toBeUndefined();
  });
  it('breakdown selected only for super_admin', () => {
    expect(selectFor(['super_admin'], 'assessmentResult').breakdown).toBe(true);
    expect(selectFor(['hr_admin'], 'assessmentResult').breakdown).toBeUndefined();
  });
  it('unknown entity → anchors-only select (fail-closed, never throws)', () => {
    expect(selectFor(['super_admin'], 'doesNotExist')).toEqual({ id: true });
  });
  it('empty roles → anchors-only select', () => {
    const sel = selectFor([], 'employeeCompensation');
    expect(sel.currentSalary).toBeUndefined();
    expect(sel.id).toBe(true);
  });
  it('assessmentResult anchors include assignmentId but not userId', () => {
    const sel = selectFor(['super_admin'], 'assessmentResult');
    expect(sel.assignmentId).toBe(true);
    expect(sel.userId).toBeUndefined();
  });
  it('band + normSampleSize selected for the same roles as percentile (recruiter/hr_admin), not for an unlisted role', () => {
    expect(selectFor(['recruiter'], 'assessmentResult').band).toBe(true);
    expect(selectFor(['recruiter'], 'assessmentResult').normSampleSize).toBe(true);
    expect(selectFor(['hr_admin'], 'assessmentResult').band).toBe(true);
    expect(selectFor(['leader'], 'assessmentResult').band).toBeUndefined();
    expect(selectFor(['leader'], 'assessmentResult').normSampleSize).toBeUndefined();
  });
});
