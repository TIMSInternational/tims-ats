/** One labelled figure in the agent usage tab. */
export function AgentUsageStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-surface p-3">
      <dt className="text-callout text-secondary">{label}</dt>
      <dd className="mt-0.5 text-title font-semibold tabular-nums text-brand">{value}</dd>
    </div>
  );
}
