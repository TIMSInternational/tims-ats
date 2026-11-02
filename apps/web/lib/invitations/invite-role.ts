import { z } from 'zod';

// Every staff-invite surface must send an explicit role: a blank role is silently turned into
// `employee` server-side, which is never what an admin who skipped the field meant.
export const inviteRoleSlugSchema = z.string().trim().min(1).max(50);

export function isInviteRoleValid(value: string | null | undefined): boolean {
  return inviteRoleSlugSchema.safeParse(value ?? '').success;
}

/** Bulk CSV rows that would be invited without a role (row numbers are 1-based, data rows only). */
export function rowsMissingRole(rows: readonly { readonly role?: string }[]): number[] {
  return rows.flatMap((row, i) => (isInviteRoleValid(row.role) ? [] : [i + 1]));
}
