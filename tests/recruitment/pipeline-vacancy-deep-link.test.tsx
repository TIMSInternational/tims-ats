import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const { listQuery, getByIdQuery } = vi.hoisted(() => ({ listQuery: vi.fn(), getByIdQuery: vi.fn() }));

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    vacancy: {
      list: { useQuery: (...args: unknown[]) => listQuery(...args) },
      getById: { useQuery: (...args: unknown[]) => getByIdQuery(...args) },
    },
  },
}));

import { usePipelineVacancySelection } from '../../apps/web/app/(admin)/recruitment/pipeline/use-pipeline-vacancy-selection';

const FIRST = { id: '11111111-1111-4111-8111-111111111111', title: 'Analista', company: null };
const SECOND = { id: '22222222-2222-4222-8222-222222222222', title: 'Contador', company: null };
const OLD = { id: '99999999-9999-4999-8999-999999999999', title: 'Vacante antigua', company: { id: 'c1', name: 'INVU' } };

function listLoaded(items: unknown[]) {
  listQuery.mockReturnValue({ data: { items, nextCursor: null }, isSuccess: true, isLoading: false, isError: false });
}

beforeEach(() => {
  listQuery.mockReset();
  getByIdQuery.mockReset();
  getByIdQuery.mockReturnValue({ data: undefined, isError: false });
});

describe('pipeline ?vacancy= deep link (Codex P2)', () => {
  it('opens a requested vacancy outside the first page and lists it as an extra option', () => {
    listLoaded([FIRST, SECOND]);
    getByIdQuery.mockReturnValue({ data: OLD, isError: false });
    const { result } = renderHook(() => usePipelineVacancySelection(OLD.id));
    expect(getByIdQuery).toHaveBeenCalledWith({ id: OLD.id }, expect.objectContaining({ enabled: true }));
    expect(result.current.selectedVacancyId).toBe(OLD.id);
    expect(result.current.options.map((v) => v.id)).toEqual([OLD.id, FIRST.id, SECOND.id]);
    expect(result.current.showUnavailableNotice).toBe(false);
  });

  it('does not switch vacancies while the lookup is still pending', () => {
    listLoaded([FIRST]);
    const { result } = renderHook(() => usePipelineVacancySelection(OLD.id));
    expect(result.current.selectedVacancyId).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it('falls back to the first vacancy with a notice when the requested one is not found', () => {
    listLoaded([FIRST, SECOND]);
    getByIdQuery.mockReturnValue({ data: undefined, isError: true });
    const { result } = renderHook(() => usePipelineVacancySelection(OLD.id));
    expect(result.current.selectedVacancyId).toBe(FIRST.id);
    expect(result.current.showUnavailableNotice).toBe(true);
    expect(result.current.options.map((v) => v.id)).toEqual([FIRST.id, SECOND.id]);
  });

  it('treats a malformed id as unavailable without calling the server', () => {
    listLoaded([FIRST]);
    const { result } = renderHook(() => usePipelineVacancySelection('not-a-uuid'));
    expect(getByIdQuery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
    expect(result.current.selectedVacancyId).toBe(FIRST.id);
    expect(result.current.showUnavailableNotice).toBe(true);
  });

  it('keeps the first-vacancy default with no notice and no lookup when no param is given', () => {
    listLoaded([FIRST, SECOND]);
    const { result } = renderHook(() => usePipelineVacancySelection(null));
    expect(getByIdQuery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
    expect(result.current.selectedVacancyId).toBe(FIRST.id);
    expect(result.current.showUnavailableNotice).toBe(false);
  });

  it('selects the requested vacancy directly when it is already in the list', () => {
    listLoaded([FIRST, SECOND]);
    const { result } = renderHook(() => usePipelineVacancySelection(SECOND.id));
    expect(result.current.selectedVacancyId).toBe(SECOND.id);
    expect(getByIdQuery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ enabled: false }));
  });
});
