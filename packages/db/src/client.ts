import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

// NOTE: a former `createTenantClient(orgId)` helper lived here. It was dead code
// (never called) and built raw SQL by interpolating orgId — the exact injection
// pattern banned by CLAUDE.md — and its `$extends(...)` return value was discarded,
// so it never actually applied. Removed. Tenant org context is set via the
// parameterized set_config(...) call in packages/api/src/trpc.ts.
