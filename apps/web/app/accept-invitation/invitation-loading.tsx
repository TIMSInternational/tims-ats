/** The invitation's shape while it loads: the summary block and two field bars (loading.md › Best practices). */
export function InvitationLoading({ label }: { label: string }) {
  const bar = 'animate-pulse rounded-lg bg-surface motion-reduce:animate-none';
  return (
    <div aria-busy="true" className="mt-6 space-y-4">
      <p role="status" className="sr-only">
        {label}
      </p>
      <div className={`h-24 rounded-xl ${bar}`} />
      <div className={`h-11 ${bar}`} />
      <div className={`h-11 ${bar}`} />
    </div>
  );
}
