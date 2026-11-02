/**
 * intake-response-schemas.test.ts — WP-26 PR-2 (candidate-spec-43).
 *
 * The web parses the platform service's public requirement list and the candidate's portal document list with
 * strict schemas, so a response that starts carrying an extra field (for example an identity number) fails the
 * parse instead of being passed through to the page.
 */
import { describe, it, expect } from 'vitest';
import { publicVacancyIntakeSchema, portalDocumentListSchema } from '@tims/shared';

const REQ = '44444444-4444-4444-8444-444444444444';
const DOC = '55555555-5555-4555-8555-555555555555';

const requirement = (overrides: Record<string, unknown> = {}) => ({
  id: REQ,
  kind: 'document',
  label: 'Título universitario',
  helpText: null,
  isKnockout: true,
  documentType: 'titulo',
  maxFiles: 1,
  minValue: null,
  ...overrides,
});

const publicIntake = (overrides: Record<string, unknown> = {}) => ({
  declarationRequired: true,
  identityRequired: true,
  allowIncompleteSubmit: true,
  declarationTextVersion: 'invu-decl-v0',
  requirements: [requirement()],
  ...overrides,
});

const portalDoc = (overrides: Record<string, unknown> = {}) => ({
  id: DOC,
  requirementId: REQ,
  fileName: 'titulo.pdf',
  contentType: 'application/pdf',
  reviewStatus: 'rejected',
  reviewReason: 'Documento ilegible',
  uploadedAt: '2026-11-02T10:00:00.000Z',
  ...overrides,
});

const portalList = (overrides: Record<string, unknown> = {}) => ({
  windowOpen: true,
  windowClosesAt: '2026-11-20T23:59:59.000Z',
  documents: [portalDoc()],
  ...overrides,
});

describe('publicVacancyIntakeSchema', () => {
  it('accepts a well-formed response', () => {
    expect(publicVacancyIntakeSchema.safeParse(publicIntake()).success).toBe(true);
  });

  it('rejects unknown keys at the top level and inside a requirement', () => {
    expect(publicVacancyIntakeSchema.safeParse(publicIntake({ organizationId: REQ })).success).toBe(false);
    expect(
      publicVacancyIntakeSchema.safeParse(publicIntake({ requirements: [requirement({ createdBy: REQ })] })).success,
    ).toBe(false);
  });

  it('rejects more than 20 requirements and an unknown kind', () => {
    const many = Array.from({ length: 21 }, () => requirement());
    expect(publicVacancyIntakeSchema.safeParse(publicIntake({ requirements: many })).success).toBe(false);
    expect(
      publicVacancyIntakeSchema.safeParse(publicIntake({ requirements: [requirement({ kind: 'other' })] })).success,
    ).toBe(false);
  });

  it('rejects maxFiles outside 1..5', () => {
    for (const maxFiles of [0, 6]) {
      expect(
        publicVacancyIntakeSchema.safeParse(publicIntake({ requirements: [requirement({ maxFiles })] })).success,
      ).toBe(false);
    }
  });
});

describe('portalDocumentListSchema', () => {
  it('accepts a well-formed response', () => {
    expect(portalDocumentListSchema.safeParse(portalList()).success).toBe(true);
  });

  it('rejects unknown keys at the top level and inside a document', () => {
    expect(portalDocumentListSchema.safeParse(portalList({ candidateId: DOC })).success).toBe(false);
    expect(
      portalDocumentListSchema.safeParse(portalList({ documents: [portalDoc({ objectKey: 'candidate-docs/x' })] }))
        .success,
    ).toBe(false);
  });

  it('rejects an unknown review status and a non-ISO upload date', () => {
    expect(
      portalDocumentListSchema.safeParse(portalList({ documents: [portalDoc({ reviewStatus: 'ok' })] })).success,
    ).toBe(false);
    expect(
      portalDocumentListSchema.safeParse(portalList({ documents: [portalDoc({ uploadedAt: 'yesterday' })] })).success,
    ).toBe(false);
  });
});
