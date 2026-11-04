/** A blocking message with one way forward (retry a failed load, or sign out another session first). */
export function InvitationNotice({
  message,
  action,
  onAction,
  busy = false,
}: {
  message: string;
  action: string;
  onAction: () => void;
  busy?: boolean;
}) {
  return (
    <div className="mt-8">
      <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        {message}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={onAction}
        className="mt-4 w-full rounded-xl bg-[#241641] px-5 py-3 font-medium text-white disabled:opacity-50"
      >
        {action}
      </button>
    </div>
  );
}
