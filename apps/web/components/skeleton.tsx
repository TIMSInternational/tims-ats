'use client';

/** A placeholder block in the shape of the final content. Stops pulsing under reduced motion. */
export function Skeleton({ className }: { className: string }) {
  return (
    <div aria-hidden="true" className={`bg-gray-200 rounded animate-pulse motion-reduce:animate-none ${className}`} />
  );
}
