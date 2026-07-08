import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TRPCError } from '@trpc/server';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports (vitest hoists vi.mock calls).
// Pure unit test: cache + repository are mocked, no live DB.
// ---------------------------------------------------------------------------
vi.mock('../../packages/api/src/lib/cache', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheInvalidatePrefix: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../packages/api/src/repositories/entitlement.repository', () => ({
  findEnabledEntitlements: vi.fn(),
}));

import { cacheGet, cacheSet, cacheInvalidatePrefix } from '../../packages/api/src/lib/cache';
import { findEnabledEntitlements } from '../../packages/api/src/repositories/entitlement.repository';
import {
  getEntitlements,
  hasEntitlement,
  requireEntitlement,
  checkLimit,
  invalidateEntitlementCache,
} from '../../packages/api/src/services/entitlement.service';

const mockRepo = vi.mocked(findEnabledEntitlements);
const mockCacheGet = vi.mocked(cacheGet);
const mockCacheSet = vi.mocked(cacheSet);
const mockCacheInvalidatePrefix = vi.mocked(cacheInvalidatePrefix);

describe('entitlement.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks clears call history but not queued resolved values — re-arm
    // the cache-miss default explicitly so each test starts from a clean slate.
    mockCacheGet.mockResolvedValue(null);
  });

  describe('getEntitlements', () => {
    it('reads through the repository on a cache miss and caches the result', async () => {
      mockCacheGet.mockResolvedValue(null);
      mockRepo.mockResolvedValue([
        { moduleCode: 'ai_voice_interview', limit: null, unitPrice: 0.15 },
      ]);

      const result = await getEntitlements('org1');

      expect(mockRepo).toHaveBeenCalledWith('org1');
      expect(mockCacheSet).toHaveBeenCalledWith(
        'tims:entitlements:org1',
        [{ moduleCode: 'ai_voice_interview', limit: null, unitPrice: 0.15 }],
        300,
      );
      expect(result.get('ai_voice_interview')).toEqual({
        moduleCode: 'ai_voice_interview',
        limit: null,
        unitPrice: 0.15,
      });
    });

    it('serves from cache on a hit and never calls the repository', async () => {
      mockCacheGet.mockResolvedValue([
        { moduleCode: 'background_check', limit: 10, unitPrice: 5 },
      ]);

      const result = await getEntitlements('org1');

      expect(mockRepo).not.toHaveBeenCalled();
      expect(mockCacheSet).not.toHaveBeenCalled();
      expect(result.get('background_check')).toEqual({
        moduleCode: 'background_check',
        limit: 10,
        unitPrice: 5,
      });
    });
  });

  describe('hasEntitlement', () => {
    it('is true when the module is enabled', async () => {
      mockRepo.mockResolvedValue([{ moduleCode: 'ai_voice_interview', limit: null, unitPrice: 0.15 }]);
      expect(await hasEntitlement('org1', 'ai_voice_interview')).toBe(true);
    });

    it('is false when the module is absent', async () => {
      mockRepo.mockResolvedValue([]);
      expect(await hasEntitlement('org1', 'ai_voice_interview')).toBe(false);
    });
  });

  describe('requireEntitlement', () => {
    it('throws a FORBIDDEN TRPCError with entitlement_missing:<code> when absent', async () => {
      mockRepo.mockResolvedValue([]);

      await expect(requireEntitlement('org1', 'ai_voice_interview')).rejects.toThrow(TRPCError);
      await expect(requireEntitlement('org1', 'ai_voice_interview')).rejects.toMatchObject({
        code: 'FORBIDDEN',
        message: 'entitlement_missing:ai_voice_interview',
      });
    });

    it('resolves the effective entitlement when present', async () => {
      mockRepo.mockResolvedValue([{ moduleCode: 'ai_voice_interview', limit: 50, unitPrice: 0.15 }]);

      const ent = await requireEntitlement('org1', 'ai_voice_interview');

      expect(ent).toEqual({ moduleCode: 'ai_voice_interview', limit: 50, unitPrice: 0.15 });
    });
  });

  describe('checkLimit — pure, meter-and-bill, never blocks', () => {
    it('signals overage when usage + amount exceeds the limit', () => {
      expect(checkLimit(100, 100, 1)).toEqual({ overage: true });
    });

    it('signals no overage when usage + amount is within the limit', () => {
      expect(checkLimit(100, 40, 1)).toEqual({ overage: false });
    });

    it('never signals overage when the limit is null (unlimited)', () => {
      expect(checkLimit(null, 999999, 1)).toEqual({ overage: false });
    });
  });

  describe('invalidateEntitlementCache', () => {
    it('invalidates the org-scoped entitlement cache key prefix', async () => {
      await invalidateEntitlementCache('org1');
      expect(mockCacheInvalidatePrefix).toHaveBeenCalledWith('tims:entitlements:org1');
    });
  });
});
