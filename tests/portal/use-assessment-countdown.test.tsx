import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAssessmentCountdown } from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_lib/use-assessment-countdown';

describe('useAssessmentCountdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns null and never fires onExpire when durationMinutes is null (untimed)', () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() =>
      useAssessmentCountdown({ startedAt: new Date(), expiresAt: null, durationMinutes: null, onExpire }),
    );
    expect(result.current).toBeNull();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('counts down from duration and fires onExpire exactly once at 0:00', () => {
    const onExpire = vi.fn();
    const startedAt = new Date();
    const { result } = renderHook(() =>
      useAssessmentCountdown({ startedAt, expiresAt: null, durationMinutes: 1, onExpire }),
    );
    expect(result.current).toBe(60);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(0);
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('uses expiresAt when it is tighter than duration', () => {
    const onExpire = vi.fn();
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + 10_000);
    const { result } = renderHook(() => useAssessmentCountdown({ startedAt, expiresAt, durationMinutes: 5, onExpire }));
    expect(result.current).toBe(10);
  });
});
