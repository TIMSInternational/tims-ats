'use client';

// Muted, proportionate "couldn't load data" row for a failed dashboard query.
// Distinct from EmptyState (which means "no data"), so an errored section never
// renders misleading zeros or an empty-looking placeholder.
export function LoadError({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg bg-[#F6F6F6] p-4 text-[13px] text-[#8B8B8B]">
      {message}
    </div>
  );
}
