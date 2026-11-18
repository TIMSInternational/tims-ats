// Class recipes for form controls (foundation-spec.md §6, text-fields.md › Best practices). The outline is
// `field-border` (3.41:1, passes the 3:1 non-text minimum); focus uses the global navy ring.

export type FieldSize = 'md' | 'lg';

const CONTROL_BASE =
  'w-full rounded-lg border border-field-border bg-white px-3 text-primary placeholder:text-muted transition-colors duration-150 hover:border-secondary focus-visible:border-brand aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted';

// Phone-width inputs are 16px so iOS Safari does not zoom on focus; desktop is the 13px body size.
const CONTROL_SIZES: Record<FieldSize, string> = {
  md: 'h-9 text-base sm:text-body pointer-coarse:h-11',
  lg: 'h-11 text-base',
};

export function inputClasses(size: FieldSize = 'md', className = ''): string {
  return `${CONTROL_BASE} ${CONTROL_SIZES[size]} ${className}`.trim();
}

export function textareaClasses(className = ''): string {
  return `${CONTROL_BASE} min-h-24 py-2 text-base sm:text-body ${className}`.trim();
}

export function selectClasses(size: FieldSize = 'md', className = ''): string {
  return `${CONTROL_BASE} ${CONTROL_SIZES[size]} pr-8 ${className}`.trim();
}

export const FIELD_LABEL_CLASSES = 'mb-1.5 block text-body font-medium text-primary';
export const FIELD_HELP_CLASSES = 'mt-1.5 text-callout text-secondary';
export const FIELD_ERROR_CLASSES = 'mt-1.5 flex items-start gap-1 text-callout text-danger';
/** Native checkbox / radio: whole row is the label. */
export const CHOICE_ROW_CLASSES = 'flex min-h-7 items-center gap-2 text-body text-primary pointer-coarse:min-h-11';
export const CHOICE_INPUT_CLASSES = 'size-4 shrink-0 accent-brand';
