export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-callout text-secondary">{label}</dt>
      <dd className="max-w-[60%] truncate text-right text-callout font-medium text-primary">{value}</dd>
    </div>
  );
}
