/** The success state: where to go next, and the two-step verification hand-off for roles that require it. */
export function InvitationReady({ open, mfaNext }: { open: string; mfaNext?: string }) {
  return (
    <>
      {mfaNext && (
        <p role="status" className="mt-6 rounded-lg bg-violet-50 p-3 text-sm leading-6">
          {mfaNext}
        </p>
      )}
      <a href="/dashboard" className="mt-8 block rounded-xl bg-[#241641] px-5 py-3 text-center font-medium text-white">
        {open}
      </a>
    </>
  );
}
