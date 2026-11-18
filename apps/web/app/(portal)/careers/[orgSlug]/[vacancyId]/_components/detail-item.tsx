export function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface p-3">
      <dt className="text-caption text-secondary">{label}</dt>
      <dd className="mt-0.5 text-body font-medium text-primary">{value}</dd>
    </div>
  );
}
