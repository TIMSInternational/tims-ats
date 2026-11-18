// "o con tu correo" between the provider buttons and the email form.
export function OrDivider({ label }: { label: string }) {
  return (
    <div className="my-6 flex items-center gap-3" role="separator" aria-label={label}>
      <div className="h-px flex-1 bg-border" aria-hidden="true" />
      <span className="text-callout text-muted" aria-hidden="true">
        {label}
      </span>
      <div className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}
