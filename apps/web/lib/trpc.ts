import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@tims/api';

export const trpc = createTRPCReact<AppRouter>();
