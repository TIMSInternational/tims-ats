// Class recipes for the shared Button (foundation-spec.md §5, buttons.md › Style and › Role). Exported so a
// control that cannot be a <Button> (a <Link> inside a menu, a <label> wrapping a file input) still looks
// like one. Navy is the one primary; red is reserved for destructive actions.

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive' | 'destructive-secondary';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors duration-150 ease-out cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:cursor-not-allowed active:translate-y-px motion-reduce:active:translate-y-0';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  secondary: 'bg-white text-brand border border-field-border hover:bg-surface',
  tertiary: 'text-brand hover:bg-brand-tint',
  destructive: 'bg-brand-red text-white hover:bg-brand-red-hover',
  'destructive-secondary': 'bg-white text-brand-red border border-brand-red/50 hover:bg-danger-bg',
};

// Every size grows to a 44px hit region on touch screens (accessibility.md › Mobility).
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-3 text-callout pointer-coarse:min-h-11',
  md: 'h-9 px-4 text-body pointer-coarse:min-h-11',
  lg: 'h-11 px-5 text-subheading',
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: ButtonStyleOptions = {}): string {
  return [BASE, VARIANTS[variant], SIZES[size], fullWidth ? 'w-full' : '', className ?? ''].filter(Boolean).join(' ');
}

/** A row of dialog or form buttons: Cancel leading, the primary trailing; stacked full width below sm. */
export const BUTTON_GROUP_CLASSES = 'flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end';

/** The text-link role: inline navigation inside copy or beside a field. */
export const TEXT_LINK_CLASSES =
  'inline-flex items-center gap-1 text-brand font-medium underline-offset-2 hover:underline pointer-coarse:min-h-11';
