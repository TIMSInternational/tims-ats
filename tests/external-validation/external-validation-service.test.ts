import { describe, it, expect, vi } from 'vitest';

const INPUT = { validationId: '11111111-1111-1111-1111-111111111111', status: 'passed' as const, result: { ok: true } };
const META = { organizationId: 'org-1', apiKeyId: 'key-1', ipAddress: '1.2.3.4', userAgent: 'vendor/1.0' };

async function load(mocks: { getForSubmit: unknown; submit: unknown; audit?: unknown }) {
  vi.resetModules();
  vi.doMock('../../packages/api/src/repositories/external-validation.repository', () => ({
    getValidationForSubmit: mocks.getForSubmit,
    submitValidationResult: mocks.submit,
  }));
  vi.doMock('../../packages/api/src/access/audit', () => ({
    logDataAccess: mocks.audit ?? vi.fn().mockResolvedValue(undefined),
  }));
  return import('../../packages/api/src/services/external-validation.service');
}

describe('externalValidationService.submitResult', () => {
  it('writes the result, records fail-soft audit with the apiKey actor, returns v1 DTO', async () => {
    const completedAt = new Date('2026-07-13T00:00:00Z');
    const audit = vi.fn().mockResolvedValue(undefined);
    const { externalValidationService } = await load({
      getForSubmit: vi.fn().mockResolvedValue({ id: 'val-1', status: 'pending' }),
      submit: vi.fn().mockResolvedValue({ count: 1, completedAt }),
      audit,
    });
    const dto = await externalValidationService.submitResult(META, INPUT, 'Bearer tims_test_key');
    expect(dto).toEqual({ schemaVersion: 'v1', id: INPUT.validationId, status: 'passed', completedAt });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        actorId: 'key-1',
        entity: 'preemploymentValidation',
        recordId: INPUT.validationId,
        action: 'update',
      }),
      { failClosed: false },
    );
  });

  it('throws NOT_FOUND when the validation is not in the key org', async () => {
    const { externalValidationService } = await load({
      getForSubmit: vi.fn().mockResolvedValue(null),
      submit: vi.fn(),
    });
    await expect(externalValidationService.submitResult(META, INPUT, 'Bearer tims_test_key')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws CONFLICT when the validation is not pending (atomic guard count 0)', async () => {
    const submit = vi.fn().mockResolvedValue({ count: 0, completedAt: new Date() });
    const { externalValidationService } = await load({
      getForSubmit: vi.fn().mockResolvedValue({ id: 'val-1', status: 'passed' }),
      submit,
    });
    await expect(externalValidationService.submitResult(META, INPUT, 'Bearer tims_test_key')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});
