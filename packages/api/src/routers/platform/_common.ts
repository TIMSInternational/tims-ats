import { protectedProcedure } from '../../trpc';
import { TRPCError } from '@trpc/server';

// Guard: only platform owners can use these procedures
export const platformProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.user.isPlatformOwner) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Acceso restringido a administradores de plataforma' });
  }
  return next();
});
