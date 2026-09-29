'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { useProctoringCapability } from '../../../../../lib/platform-api/proctoring';
import { useProctoringStaffAccess } from '../../../../../lib/proctoring/staff-access';
import {
  useGrantProctoringAccommodation,
  type ProctoringAccommodationReason,
} from '../../../../../lib/platform-api/proctoring-staff';

export function ProctoringAccommodation({ assignmentId }: { assignmentId: string }) {
  const { t } = useI18n();
  const copy = t.proctoring.accommodation;
  const [reason, setReason] = useState<ProctoringAccommodationReason>('technical_unavailable');
  const capability = useProctoringCapability();
  const access = useProctoringStaffAccess();
  const mutation = useGrantProctoringAccommodation();
  const utils = trpc.useUtils();

  if (!access.canWrite || !capability.data?.enabled) return null;

  return (
    <form
      className="mt-3 space-y-2 rounded-lg border border-[#DCD4EC] bg-[#F9F7FC] p-3"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate({ assignmentId, reason }, {
          onSuccess: () => { void utils.candidate.getById.invalidate(); },
        });
      }}
    >
      <p className="text-xs font-semibold text-[#1F114C]">{copy.title}</p>
      <p className="text-xs text-[#585858]">{copy.description}</p>
      <label className="block text-xs text-[#585858]">
        {copy.reason}
        <select
          value={reason}
          onChange={(event) => setReason(event.target.value as ProctoringAccommodationReason)}
          className="mt-1 block w-full rounded border border-[#D1D5DB] bg-white px-2 py-2 text-xs"
        >
          <option value="technical_unavailable">{copy.technicalUnavailable}</option>
          <option value="accessibility">{copy.accessibility}</option>
          <option value="other">{copy.other}</option>
        </select>
      </label>
      {mutation.isError ? <p role="alert" className="text-xs text-[#B42318]">{copy.saveError}</p> : null}
      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-lg border border-[#1F114C] px-3 py-2 text-xs font-medium text-[#1F114C] disabled:opacity-50"
      >
        {copy.allowWithoutMonitoring}
      </button>
    </form>
  );
}
