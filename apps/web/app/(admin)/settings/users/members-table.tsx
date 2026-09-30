'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { DataTable, EmptyState, ErrorState } from '../../../../components';

// Data source: the existing tenant-scoped `user.list` tRPC read (user:read, org from ctx). The C#
// people directory (#304) is not merged yet; swap this read for its client once it is. `isActive: true`
// hides deactivated and soft-deleted members (user.list pairs it with deletedAt: null).
export function MembersTable() {
  const { t } = useI18n();
  const m = t.teamSettings;
  const members = trpc.user.list.useInfiniteQuery(
    { limit: 50, isActive: true },
    { getNextPageParam: (last) => last.nextCursor, retry: false },
  );

  if (members.isError) return <ErrorState message={m.membersError} onRetry={() => void members.refetch()} />;

  const rows = members.data?.pages.flatMap((page) => page.users) ?? [];

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        loading={members.isLoading}
        columns={[
          { key: 'name', label: m.colName },
          { key: 'email', label: m.colEmail },
          { key: 'jobTitle', label: m.colJobTitle },
        ]}
        empty={<EmptyState icon={null} message={m.membersEmpty} />}
      >
        {rows.map((user) => (
          <tr key={user.id} className="border-b border-[#EDEDED] last:border-0">
            <td className="px-4 py-3 text-sm text-[#333]">{`${user.firstName} ${user.lastName}`.trim()}</td>
            <td className="px-4 py-3 text-sm text-[#585858]">{user.email}</td>
            <td className="px-4 py-3 text-sm text-[#585858]">{user.jobTitle ?? ''}</td>
          </tr>
        ))}
      </DataTable>
      {members.hasNextPage && (
        <button
          type="button"
          onClick={() => void members.fetchNextPage()}
          disabled={members.isFetchingNextPage}
          className="self-center h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#1F114C] hover:bg-[#F7F7F7] transition disabled:opacity-50"
        >
          {m.loadMore}
        </button>
      )}
    </div>
  );
}
