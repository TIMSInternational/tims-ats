'use client';

import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { CandidateAvatar } from './candidate-avatar';

/** Minimal user shape the picker hands back alongside the id. */
export interface PickedUser {
  id: string;
  firstName: string;
  lastName: string;
}

interface UserPickerProps {
  /** User ids to hide from the list (e.g. already-assigned members). */
  excludeIds?: string[];
  /**
   * Called when a user is selected. The selected user object is passed as a
   * second argument so callers that hold a recipient before submitting can
   * display the real name (callers that mutate immediately can ignore it).
   */
  onSelect: (userId: string, user: PickedUser) => void;
  /** Disables the buttons while a mutation is in flight. */
  disabled?: boolean;
  searchPlaceholder: string;
  loadingLabel: string;
  emptyLabel: string;
}

/**
 * Searchable org-user picker. Backed by `trpc.user.list` (the only org-member
 * query the admin UI exposes). Returns a userId (and the user object) via
 * onSelect on click.
 */
export function UserPicker({
  excludeIds = [],
  onSelect,
  disabled = false,
  searchPlaceholder,
  loadingLabel,
  emptyLabel,
}: UserPickerProps) {
  const [search, setSearch] = useState('');
  const q = trpc.user.list.useQuery({ limit: 25, search: search || undefined, isActive: true });

  const exclude = new Set(excludeIds);
  const users = (q.data?.users ?? []).filter((u) => !exclude.has(u.id));

  return (
    <div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={searchPlaceholder}
        className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] placeholder:text-[#B8B8B8] focus:outline-none focus:border-[#1F114C]/40"
        autoFocus
      />
      <div className="mt-2 border border-[#EDEDED] rounded-lg max-h-[260px] overflow-y-auto bg-white">
        {q.isLoading ? (
          <p className="px-3 py-3 text-[12px] text-[#8B8B8B]">{loadingLabel}</p>
        ) : users.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-[#8B8B8B]">{emptyLabel}</p>
        ) : (
          users.map((u) => (
            <button
              key={u.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(u.id, { id: u.id, firstName: u.firstName, lastName: u.lastName })}
              className="w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-[#F6F6F6] transition disabled:opacity-50 disabled:cursor-not-allowed border-b border-[#F6F6F6] last:border-0"
            >
              <CandidateAvatar firstName={u.firstName} lastName={u.lastName} avatar={u.avatar} size="sm" />
              <div className="min-w-0">
                <p className="text-[12px] text-[#333] font-medium truncate">
                  {u.firstName} {u.lastName}
                </p>
                <p className="text-[10px] text-[#8B8B8B] truncate">{u.email}</p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
