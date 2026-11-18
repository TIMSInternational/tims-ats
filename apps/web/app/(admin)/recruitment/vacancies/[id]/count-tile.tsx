/** Counts are ordinary facts, so the tiles are neutral (color.md: one colour, one meaning — red is for destruction). */
export function CountTile({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 rounded-lg bg-surface p-2.5 text-center">
      <p className="text-2xl font-semibold tabular-nums text-primary">{value}</p>
      <p className="text-caption text-secondary">{label}</p>
    </div>
  );
}
