import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export function createTenantClient(orgId: string): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  client.$extends({
    query: {
      $allOperations({ args, query }) {
        // Inject organization_id filter for RLS
        // This works with Supabase RLS policies that check current_setting('app.current_org_id')
        return client.$executeRawUnsafe(
          `SET LOCAL app.current_org_id = '${orgId}'`
        ).then(() => query(args));
      },
    },
  });

  return client;
}
