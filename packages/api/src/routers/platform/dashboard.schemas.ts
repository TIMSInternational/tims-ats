import { z } from 'zod';

export const searchInput = z.object({ query: z.string().min(1).max(100) });
