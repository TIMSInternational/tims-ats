import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@tims/api';

type PlatformOutput = inferRouterOutputs<AppRouter>['platform'];

/** The slice of a react-query result these read-only panels render. */
export interface QueryState<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

export type AgentKpisQuery = QueryState<PlatformOutput['getAiAgentKpis']>;
export type AgentDetailQuery = QueryState<PlatformOutput['getAiAgent']>;
export type AgentUsageQuery = QueryState<PlatformOutput['getAiAgentUsage']>;
