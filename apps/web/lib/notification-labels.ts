// Display labels for the notification bell. Pure (no React) so node tests can exercise it.
//
// `notification.module` is a free-text column (the tRPC create input is `z.string().max(50)`, the C#
// consent flow writes "candidate", broadcasts write "platform"), so a raw slug must never reach the UI:
// a known module maps to its i18n label and anything else hides the chip.

type Labels = Readonly<Record<string, string>>;

const own = (labels: Labels, key: string) => Object.prototype.hasOwnProperty.call(labels, key);

/** The translated module chip text, or null when the module is empty or unknown (chip hidden). */
export function notificationModuleLabel(labels: Labels, module: string | null | undefined): string | null {
  if (!module || !own(labels, module)) return null;
  return labels[module] ?? null;
}

/** The translated severity name, read by screen readers next to the colour dot; unknown types read as info. */
export function notificationTypeLabel(labels: Labels & { readonly info: string }, type: string): string {
  return own(labels, type) ? (labels[type] ?? labels.info) : labels.info;
}
