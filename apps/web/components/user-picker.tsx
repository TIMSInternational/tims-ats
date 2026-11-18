'use client';

import { useId, useState } from 'react';
import { trpc } from '../lib/trpc';
import {
  useAssignablePeople,
  type AssignablePurpose,
  type AssignablePeopleFailure,
} from '../lib/platform-api/assignable-people';
import { AssignablePeopleError } from './assignable-people-error';
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
  /**
   * The list comes from the tenant assignable-people directory for this purpose (C# when
   * NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP is on — it is in production — tRPC user.list otherwise),
   * gated on the permission of the mutation the picker feeds, so roles without user:read can pick people.
   * Approver eligibility is permission-based (scope-aware only for 'vacancy_approver' with `vacancyId`);
   * subject-scoped purposes list a narrow caller's subject set. The submit mutation re-checks scope and
   * callers must show its error.
   */
  purpose?: AssignablePurpose;
  /** Focus the search box on mount (modals). Inline pickers on a page pass false. Defaults to true. */
  autoFocus?: boolean;
  /** With purpose 'vacancy_approver': only offer approvers whose scope covers this vacancy (C# directory). */
  vacancyId?: string;
  /** Shown instead of `emptyLabel` when the list is empty and nothing has been searched. */
  emptyHint?: string;
  /** A visible label above the search box. Omit when the caller renders its own label (use `inputId`). */
  label?: string;
  /** Id for the search input, so a caller's <label htmlFor> names it. */
  inputId?: string;
  /** Id of an element that already names the picker (e.g. the modal title). */
  ariaLabelledBy?: string;
  /** Accessible name when nothing visible names the field. Defaults to the placeholder. */
  ariaLabel?: string;
  /** 'onFocus' keeps the result list closed until the field is focused or typed into (two pickers in one dialog). */
  listMode?: 'always' | 'onFocus';
}

interface PickerSource {
  rows: Array<{ id: string; firstName: string; lastName: string; email: string; avatar: string | null }>;
  isLoading: boolean;
  failure: AssignablePeopleFailure | null;
  refetch: () => void;
}

/**
 * Searchable org-user picker. Returns a userId (and the user object) via onSelect on click. Every app call
 * site passes a `purpose` (#317); without one it falls back to `trpc.user.list`, which needs user:read.
 */
export function UserPicker({
  excludeIds = [],
  onSelect,
  disabled = false,
  searchPlaceholder,
  loadingLabel,
  emptyLabel,
  purpose,
  autoFocus = true,
  vacancyId,
  emptyHint,
  label,
  inputId,
  ariaLabelledBy,
  ariaLabel,
  listMode = 'always',
}: UserPickerProps) {
  const [search, setSearch] = useState('');
  const [touched, setTouched] = useState(false);
  const autoId = useId();
  const fieldId = inputId ?? `user-picker-${autoId}`;
  const showList = listMode === 'always' || touched || search !== '';
  const legacy = trpc.user.list.useQuery(
    { limit: 25, search: search || undefined, isActive: true },
    { enabled: purpose === undefined },
  );
  const directory = useAssignablePeople({
    purpose: purpose ?? 'interview_evaluator',
    search,
    limit: 25,
    enabled: purpose !== undefined,
    vacancyId,
  });

  const source: PickerSource =
    purpose !== undefined
      ? {
          rows: directory.people,
          isLoading: directory.isLoading,
          failure: directory.failure,
          refetch: directory.refetch,
        }
      : {
          rows: (legacy.data?.users ?? []).map((u) => ({ ...u, avatar: u.avatar ?? null })),
          isLoading: legacy.isLoading,
          failure: legacy.isError ? (legacy.error.data?.code === 'FORBIDDEN' ? 'forbidden' : 'unavailable') : null,
          refetch: () => void legacy.refetch(),
        };

  const exclude = new Set(excludeIds);
  const users = source.rows.filter((u) => !exclude.has(u.id));

  return (
    <div>
      {label && (
        <label htmlFor={fieldId} className="mb-1.5 block text-body font-medium text-primary">
          {label}
        </label>
      )}
      <input
        id={fieldId}
        type="text"
        value={search}
        maxLength={100}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => setTouched(true)}
        placeholder={searchPlaceholder}
        aria-labelledby={label || inputId ? undefined : ariaLabelledBy}
        aria-label={label || inputId || ariaLabelledBy ? undefined : (ariaLabel ?? searchPlaceholder)}
        className="h-9 w-full rounded-lg border border-field-border bg-white px-3 text-base text-primary placeholder:text-muted hover:border-secondary focus-visible:border-brand sm:text-body pointer-coarse:h-11"
        autoFocus={autoFocus}
      />
      {showList && (
        <div className="mt-2 border border-border rounded-lg max-h-[260px] overflow-y-auto bg-white">
          {source.failure ? (
            <AssignablePeopleError failure={source.failure} onRetry={source.refetch} />
          ) : source.isLoading ? (
            <p role="status" className="px-3 py-3 text-callout text-secondary">
              {loadingLabel}
            </p>
          ) : users.length === 0 ? (
            <p role="status" className="px-3 py-3 text-callout text-secondary">
              {emptyHint && search.trim() === '' && source.rows.length === 0 ? emptyHint : emptyLabel}
            </p>
          ) : (
            users.map((u) => (
              <button
                key={u.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(u.id, { id: u.id, firstName: u.firstName, lastName: u.lastName })}
                className="w-full text-left px-3 py-2.5 min-h-12 flex items-center gap-2.5 hover:bg-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed border-b border-border-subtle last:border-0"
              >
                <CandidateAvatar firstName={u.firstName} lastName={u.lastName} avatar={u.avatar} size="sm" decorative />
                <div className="min-w-0">
                  <p className="text-body text-primary font-medium truncate">
                    {u.firstName} {u.lastName}
                  </p>
                  <p className="text-caption text-muted truncate">{u.email}</p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
