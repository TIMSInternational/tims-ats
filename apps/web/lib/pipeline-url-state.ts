// The pipeline board's working context lives in the URL (A-09): the vacancy, the view, the status toggle
// ("Activos | Rechazados | Todos") and the filters. Opening a candidate and pressing Back returns to the
// same board instead of the first vacancy, kanban view, filters cleared. Pure module, node-testable.

export const BOARD_VIEWS = ['kanban', 'list', 'table'] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];

/** The statuses pipeline.getBoard accepts. */
export const BOARD_STATUSES = ['active', 'rejected', 'all'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export interface BoardFilters {
  source: string | null;
  fitMin: number | null;
  maxDays: number | null;
  slaOnly: boolean;
}

export interface BoardUrlState {
  vacancy: string | null;
  /** null when the URL names no view: the page then picks its default (list on a phone). */
  view: BoardView | null;
  status: BoardStatus;
  filters: BoardFilters;
}

interface ParamsLike {
  get(name: string): string | null;
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function boundedInt(value: string | null, min: number, max: number): number | null {
  if (value === null || !/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/** Reads (and validates) the board state from the query string; anything malformed falls back to default. */
export function readBoardUrlState(params: ParamsLike | null | undefined): BoardUrlState {
  const get = (name: string) => params?.get(name) ?? null;
  const source = get('source');
  return {
    vacancy: get('vacancy'),
    view: oneOf(get('view'), BOARD_VIEWS),
    status: oneOf(get('status'), BOARD_STATUSES) ?? 'active',
    filters: {
      source: source !== null && /^[a-z_]{1,40}$/.test(source) ? source : null,
      fitMin: boundedInt(get('fit'), 1, 100),
      maxDays: boundedInt(get('days'), 1, 365),
      slaOnly: get('sla') === '1',
    },
  };
}

/** The query string for a board state (defaults omitted), e.g. "?vacancy=…&view=table&status=rejected". */
export function boardUrlQuery(state: BoardUrlState): string {
  const params = new URLSearchParams();
  if (state.vacancy) params.set('vacancy', state.vacancy);
  if (state.view) params.set('view', state.view);
  if (state.status !== 'active') params.set('status', state.status);
  if (state.filters.source) params.set('source', state.filters.source);
  if (state.filters.fitMin) params.set('fit', String(state.filters.fitMin));
  if (state.filters.maxDays) params.set('days', String(state.filters.maxDays));
  if (state.filters.slaOnly) params.set('sla', '1');
  const query = params.toString();
  return query ? `?${query}` : '';
}
