import { describe, it, expect } from 'vitest';
import { Prisma } from '@tims/db';

describe('360 Evaluation schema', () => {
  it('defines ReviewCycle mapped to review_cycles with the lifecycle + FK fields', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'ReviewCycle');
    expect(model).toBeDefined();
    expect(model!.dbName).toBe('review_cycles');
    const fieldNames = model!.fields.map((f) => f.name);
    expect(fieldNames).toEqual(
      expect.arrayContaining([
        'id', 'organizationId', 'name', 'status', 'opensAt', 'closesAt',
        'publishedAt', 'createdById', 'createdAt', 'updatedAt', 'createdBy', 'assignments',
      ]),
    );
    const status = model!.fields.find((f) => f.name === 'status');
    expect(status!.type).toBe('ReviewCycleStatus');
  });

  it('defines RaterAssignment mapped to rater_assignments with the relationship + status fields', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'RaterAssignment');
    expect(model).toBeDefined();
    expect(model!.dbName).toBe('rater_assignments');
    const fieldNames = model!.fields.map((f) => f.name);
    expect(fieldNames).toEqual(
      expect.arrayContaining([
        'id', 'organizationId', 'cycleId', 'subjectUserId', 'raterUserId',
        'relationship', 'status', 'submittedAt', 'createdAt', 'updatedAt',
        'cycle', 'subject', 'rater', 'responses',
      ]),
    );
    const relationship = model!.fields.find((f) => f.name === 'relationship');
    expect(relationship!.type).toBe('RaterRelationship');
    const status = model!.fields.find((f) => f.name === 'status');
    expect(status!.type).toBe('RaterAssignmentStatus');
  });

  it('enforces @@unique([cycleId, subjectUserId, raterUserId]) on RaterAssignment', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'RaterAssignment');
    const uniqueIndex = model!.uniqueIndexes.find(
      (idx) =>
        idx.fields.length === 3 &&
        idx.fields.includes('cycleId') &&
        idx.fields.includes('subjectUserId') &&
        idx.fields.includes('raterUserId'),
    );
    expect(uniqueIndex).toBeDefined();
  });

  it('defines RaterResponse mapped to rater_responses with competency + rating fields', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'RaterResponse');
    expect(model).toBeDefined();
    expect(model!.dbName).toBe('rater_responses');
    const fieldNames = model!.fields.map((f) => f.name);
    expect(fieldNames).toEqual(
      expect.arrayContaining([
        'id', 'organizationId', 'assignmentId', 'competencyKey', 'rating',
        'comment', 'createdAt', 'updatedAt', 'assignment',
      ]),
    );
    const rating = model!.fields.find((f) => f.name === 'rating');
    expect(rating!.type).toBe('Int');
    const comment = model!.fields.find((f) => f.name === 'comment');
    expect(comment!.isRequired).toBe(false);
  });

  it('enforces @@unique([assignmentId, competencyKey]) on RaterResponse', () => {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === 'RaterResponse');
    const uniqueIndex = model!.uniqueIndexes.find(
      (idx) =>
        idx.fields.length === 2 &&
        idx.fields.includes('assignmentId') &&
        idx.fields.includes('competencyKey'),
    );
    expect(uniqueIndex).toBeDefined();
  });

  it('defines the 3 evaluation360 enums with the exact values', () => {
    const enums = Prisma.dmmf.datamodel.enums;
    const reviewCycleStatus = enums.find((e) => e.name === 'ReviewCycleStatus');
    const raterRelationship = enums.find((e) => e.name === 'RaterRelationship');
    const raterAssignmentStatus = enums.find((e) => e.name === 'RaterAssignmentStatus');
    expect(reviewCycleStatus!.values.map((v) => v.name)).toEqual(['draft', 'open', 'closed', 'published']);
    expect(raterRelationship!.values.map((v) => v.name)).toEqual(['self', 'manager', 'peer', 'direct_report']);
    expect(raterAssignmentStatus!.values.map((v) => v.name)).toEqual(['pending', 'submitted']);
  });
});
