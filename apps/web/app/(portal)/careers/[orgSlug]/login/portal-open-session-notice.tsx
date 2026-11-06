'use client';

interface PortalOpenSessionNoticeProps {
  message: string;
  action: string;
  failed: string | null;
  busy: boolean;
  onContinue: () => void;
}

/** "Tiene una sesión abierta como {email}" with the explicit sign-out that lets the candidate continue (E-19). */
export function PortalOpenSessionNotice({ message, action, failed, busy, onContinue }: PortalOpenSessionNoticeProps) {
  return (
    <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
      <p>{message}</p>
      {failed && <p className="mt-2 text-red-700">{failed}</p>}
      <button
        type="button"
        onClick={onContinue}
        disabled={busy}
        className="mt-3 h-10 rounded-xl bg-[#1F114C] px-4 text-[13px] font-semibold text-white disabled:opacity-60"
      >
        {action}
      </button>
    </div>
  );
}
