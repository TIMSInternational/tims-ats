import { initTRPC } from "@trpc/server";
import superjson from "superjson";

const t = initTRPC.create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const appRouter = router({
  // Routers added per phase
  // vacancy: vacancyRouter,
  // pipeline: pipelineRouter,
  // candidate: candidateRouter,
});

export type AppRouter = typeof appRouter;
