// The candidate dashboard's controls in the TIMS evaluation design: the PCA app's own recipes (primitives.tsx,
// PCA-DESIGN.md §6) on the `eval-*` tokens. Buttons, chips, callouts, fields, the consent checkbox row, the progress
// bar, the step list, the code tile, and the full-text sheet. The confirm dialog reuses the frame's LEAVE_* recipe
// (provider-frame-styles.ts). Constants only: never a class list inside a ternary (the i18n scanner reads those as copy).

// ─── Buttons ──────────────────────────────────────────────────────────────────────────────────────

export type EvalButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'secondary-danger';
/** bar = the PCA action-bar height (52px phone / 48px md), for a section's main actions; compact = 44px, in a panel. */
export type EvalButtonSize = 'bar' | 'compact';
/** fit = its content; full = the row; bar = full width on phones (where the PCA bar would be), its content from md. */
export type EvalButtonWidth = 'fit' | 'full' | 'bar';

/** RButton base: semibold, 16px phone / 15px md, radius 8, 18px icons. The disabled look is the PCA soft-disabled one
 * (bg3, ink2, no border) on the native `disabled` attribute; busy buttons are disabled too (EvalButton). */
const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 px-5 rounded-eval-btn font-semibold text-eval-md md:text-eval-base leading-tight text-center select-none transition-colors motion-reduce:transition-none [&_svg]:size-[18px] [&_svg]:shrink-0 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-eval-bg3 disabled:text-eval-ink2 disabled:hover:bg-eval-bg3';

export const EVAL_BUTTON_VARIANTS: Record<EvalButtonVariant, string> = {
  primary: 'bg-eval-accent text-eval-on-accent hover:bg-eval-accent-hover',
  secondary: 'border border-eval-line bg-white font-normal text-eval-ink hover:bg-eval-bg2',
  ghost: 'bg-transparent text-eval-accent hover:bg-eval-bg2',
  /** Only the CONFIRM button inside a destructive dialog. */
  danger: 'bg-eval-danger text-eval-on-accent',
  /** [compose] A destructive action on the page itself ("Withdraw my application"): the secondary shape, danger text. */
  'secondary-danger': 'border border-eval-line bg-white font-normal text-eval-danger hover:bg-eval-danger-tint',
};

export const EVAL_BUTTON_SIZES: Record<EvalButtonSize, string> = {
  bar: 'min-h-13 md:min-h-12',
  compact: 'min-h-11',
};

export const EVAL_BUTTON_WIDTHS: Record<EvalButtonWidth, string> = {
  fit: '',
  full: 'w-full',
  bar: 'w-full md:w-auto',
};

export interface EvalButtonStyleOptions {
  variant?: EvalButtonVariant;
  size?: EvalButtonSize;
  width?: EvalButtonWidth;
  className?: string;
}

/** The EvalButton look for an element that cannot be an EvalButton (an <a> to an external meeting link). The ghost
 * variant is always 44px tall (PCA). */
export function evalButtonClasses({
  variant = 'primary',
  size = 'bar',
  width = 'fit',
  className = '',
}: EvalButtonStyleOptions = {}): string {
  const height = variant === 'ghost' ? EVAL_BUTTON_SIZES.compact : EVAL_BUTTON_SIZES[size];
  return [BUTTON_BASE, EVAL_BUTTON_VARIANTS[variant], height, EVAL_BUTTON_WIDTHS[width], className]
    .filter(Boolean)
    .join(' ');
}

/** A row of actions: phones stacked full width (primary on top when it is last in the DOM), md one trailing row. */
export const EVAL_ACTIONS_CLASSES = 'flex flex-col-reverse gap-2.5 md:flex-row md:items-center md:justify-end md:gap-3';
/** A row of actions that starts at the left on md (an action under a panel's text). */
export const EVAL_ACTIONS_START_CLASSES = 'flex flex-col-reverse gap-2.5 md:flex-row md:items-center md:gap-3';

// ─── Chip (status word + icon) ───────────────────────────────────────────────────────────────────

export type EvalChipTone = 'neutral' | 'warn' | 'ok' | 'danger';
/** Chip: 28px tall pill, 0.76rem semibold, 14px icon. */
export const EVAL_CHIP_CLASSES =
  'inline-flex min-h-7 shrink-0 items-center gap-1.5 self-start whitespace-nowrap rounded-full px-2.5 text-[0.76rem] font-semibold [&_svg]:size-3.5 [&_svg]:shrink-0';
export const EVAL_CHIP_TONES: Record<EvalChipTone, string> = {
  neutral: 'bg-eval-bg2 text-eval-ink2',
  /** Needs the candidate's action (e.g. "Consent needed"). */
  warn: 'bg-eval-warn-tint text-eval-warn',
  /** Done. */
  ok: 'bg-eval-ok-tint text-eval-ok',
  /** [compose] Failed, expired, withdrawn, declined. */
  danger: 'bg-eval-danger-tint text-eval-danger',
};

// ─── Callout ─────────────────────────────────────────────────────────────────────────────────────

export type EvalCalloutTone = 'neutral' | 'info' | 'warn' | 'err' | 'ok';
/** Callout: soft box, 13px ink text, the 20px icon carries the tone (PCA primitives.tsx). */
export const EVAL_CALLOUT_CLASSES =
  'flex items-start gap-2.5 rounded-eval-btn px-3.5 py-3 text-eval-sm leading-[1.45] text-eval-ink [&>svg]:mt-px [&>svg]:size-5 [&>svg]:shrink-0';
export const EVAL_CALLOUT_TONES: Record<EvalCalloutTone, string> = {
  neutral: 'bg-eval-bg2 [&>svg]:text-eval-ink2',
  info: 'bg-eval-bg2 [&>svg]:text-eval-accent',
  warn: 'bg-eval-warn-tint [&>svg]:text-eval-warn',
  err: 'bg-eval-danger-tint [&>svg]:text-eval-danger',
  ok: 'bg-eval-ok-tint [&>svg]:text-eval-ok',
};
export const EVAL_CALLOUT_BODY_CLASSES = 'min-w-0 flex-1';
/** A callout's first line, when it has a title and a line under it (a load error). */
export const EVAL_CALLOUT_TITLE_CLASSES = 'm-0 font-semibold';

// ─── Fields ──────────────────────────────────────────────────────────────────────────────────────

export const EVAL_FIELD_CLASSES = 'flex flex-col gap-1.5';
export const EVAL_FIELD_LABEL_CLASSES = 'text-[0.88rem] font-semibold text-eval-ink';
export const EVAL_FIELD_LABEL_HIDDEN_CLASSES = 'sr-only';
export const EVAL_FIELD_REQUIRED_CLASSES = 'ml-0.5 text-eval-danger';
export const EVAL_FIELD_OPTIONAL_CLASSES = 'font-normal text-eval-ink2';
export const EVAL_FIELD_HELP_CLASSES = 'm-0 text-[0.78rem] text-eval-ink2';
export const EVAL_FIELD_ERROR_CLASSES = 'm-0 flex items-start gap-1.5 text-[0.82rem] font-medium text-eval-danger';
export const EVAL_FIELD_ERROR_ICON_CLASSES = 'mt-0.5 size-4 shrink-0';
/** The PCA text input box, on the <input> itself (the global `tims-eval` ring is the PCA's focus-within outline):
 * 50px, radius 12, field border, 16px text (no iOS zoom). Invalid = 2px danger border, from aria-invalid. */
export const EVAL_INPUT_CLASSES =
  'min-h-[50px] w-full min-w-0 rounded-xl border border-eval-field bg-white px-3.5 py-3 text-[1rem] text-eval-ink placeholder:text-eval-ph aria-[invalid=true]:border-2 aria-[invalid=true]:border-eval-danger disabled:cursor-not-allowed disabled:border-transparent disabled:bg-eval-bg2 disabled:text-eval-ink2';
/** The same box on a <textarea>: grows, line-height 1.5. */
export const EVAL_TEXTAREA_CLASSES = `${EVAL_INPUT_CLASSES} min-h-24 resize-y leading-[1.5]`;
/** A character counter or a note beside a field. */
export const EVAL_FIELD_COUNTER_CLASSES = 'm-0 text-[0.78rem] text-eval-ink2';

// ─── Checkbox row (consent steps) ────────────────────────────────────────────────────────────────

/** A PCA radio-card-shaped row; the whole row is the label. Checked = 2px accent border + accent tint (padding drops
 * 1px so nothing moves). The ring is drawn on the row when the hidden native box has keyboard focus. */
export const EVAL_CHECK_ROW_CLASSES =
  'flex min-h-[50px] cursor-pointer items-center gap-3 rounded-xl border border-eval-field bg-white px-3.5 py-3 text-[0.96rem] leading-[1.45] text-eval-ink has-[:checked]:border-2 has-[:checked]:border-eval-accent has-[:checked]:bg-eval-accent-tint has-[:checked]:px-[13px] has-[:checked]:py-[11px] has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-eval-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-eval-bg2';
export const EVAL_CHECK_BOX_WRAP_CLASSES = 'relative grid size-6 shrink-0 place-items-center';
/** The native checkbox: invisible, a 44px hit area around the 24px box. */
export const EVAL_CHECK_INPUT_CLASSES = 'peer absolute inset-[-10px] m-0 size-11 cursor-pointer opacity-0';
/** The visible box: 24px, radius 7, 2px field border; checked = accent fill with a white check. */
export const EVAL_CHECK_BOX_CLASSES =
  'pointer-events-none grid size-6 place-items-center rounded-[7px] border-2 border-eval-field bg-white text-eval-on-accent peer-checked:border-eval-accent peer-checked:bg-eval-accent';
export const EVAL_CHECK_ICON_CLASSES = 'size-4';
export const EVAL_CHECK_LABEL_CLASSES = 'min-w-0 flex-1';

// ─── Progress, step list, code tile ──────────────────────────────────────────────────────────────

/** ProgressBar: 5px (6px md) track in the divider colour, accent fill. */
export const EVAL_PROGRESS_TRACK_CLASSES = 'h-[5px] w-full overflow-hidden rounded-full bg-eval-divider md:h-1.5';
export const EVAL_PROGRESS_FILL_CLASSES = 'h-full rounded-full bg-eval-accent';
/** Fill widths in 5% steps, so the bar needs no inline style. */
export const EVAL_PROGRESS_WIDTHS = [
  'w-0',
  'w-[5%]',
  'w-[10%]',
  'w-[15%]',
  'w-[20%]',
  'w-[25%]',
  'w-[30%]',
  'w-[35%]',
  'w-[40%]',
  'w-[45%]',
  'w-[50%]',
  'w-[55%]',
  'w-[60%]',
  'w-[65%]',
  'w-[70%]',
  'w-[75%]',
  'w-[80%]',
  'w-[85%]',
  'w-[90%]',
  'w-[95%]',
  'w-full',
] as const;
/** The SheetHead block (eyebrow row + progress) at the top of a multi-step guide. */
export const EVAL_STEP_HEAD_CLASSES = 'flex flex-col gap-2 md:gap-2.5';

/** StepList inside a bordered panel (the consent review): rows 48px, divider between them. */
export const EVAL_STEP_LIST_CLASSES = 'm-0 list-none rounded-eval-card border border-eval-line px-4 py-0.5';
export const EVAL_STEP_ROW_CLASSES =
  'flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b border-eval-divider py-2.5 text-eval-base text-eval-ink last:border-b-0';
export type EvalStepMarkerState = 'done' | 'todo';
export const EVAL_STEP_MARKER_CLASSES =
  'grid size-7 shrink-0 place-items-center rounded-eval-btn text-eval-sm [&_svg]:size-4';
export const EVAL_STEP_MARKER_STATES: Record<EvalStepMarkerState, string> = {
  done: 'bg-eval-ok text-white',
  todo: 'bg-eval-bg3 text-eval-ink2',
};
export const EVAL_STEP_LABEL_CLASSES = 'min-w-0 flex-1';

export type EvalCodeTileSize = 'md' | 'sm';
/** [compose] The instrument's code ("LIA", "EN"): a soft tile, mono, ink2. */
export const EVAL_CODE_TILE_CLASSES =
  'grid shrink-0 place-items-center rounded-eval-btn bg-eval-bg3 font-eval-mono font-semibold text-eval-ink2';
export const EVAL_CODE_TILE_SIZES: Record<EvalCodeTileSize, string> = {
  md: 'size-10 text-eval-xs',
  sm: 'size-8 text-eval-2xs',
};

// ─── Bottom sheet (the full text of a consent) ──────────────────────────────────────────────────

/** The scrim; a bottom sheet on phones, centred from md. */
export const EVAL_SHEET_SCRIM_CLASSES = 'fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6';
export const EVAL_SHEET_BACKDROP_CLASSES = 'absolute inset-0 bg-eval-scrim';
/** The panel: radius 16 on top (all round from md), max 85dvh and scrolls, safe-area room at the bottom, max 520 md. */
export const EVAL_SHEET_PANEL_CLASSES =
  'relative max-h-[85dvh] w-full animate-eval-sheet-in overflow-y-auto rounded-t-eval-sheet bg-white px-5 pt-2 pb-[max(34px,env(safe-area-inset-bottom))] text-eval-ink shadow-eval-pop motion-reduce:animate-none md:max-w-[520px] md:rounded-eval-sheet md:p-8';
export const EVAL_SHEET_GRABBER_CLASSES = 'mx-auto mb-3.5 h-[5px] w-9 rounded-[3px] bg-eval-bg3 md:hidden';
export const EVAL_SHEET_HEAD_CLASSES = 'flex items-start justify-between gap-3';
export const EVAL_SHEET_TITLE_PAD_CLASSES = 'pt-2.5';
/** The PCA filled icon button (✕). */
export const EVAL_SHEET_CLOSE_X_CLASSES =
  'ml-auto inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-eval-btn bg-eval-bg2 text-eval-ink hover:bg-eval-bg3 [&_svg]:size-5';
export const EVAL_SHEET_BODY_CLASSES = 'mt-3 text-eval-base leading-[1.55] text-eval-ink';
export const EVAL_SHEET_FOOT_CLASSES = 'mt-6';

// ─── Confirm dialog (alert dialog) ──────────────────────────────────────────────────────────────

export type EvalAlertTone = 'warn' | 'danger';
/** Fixed over the page (the frame's LEAVE_SCRIM_CLASSES is absolute inside the frame). */
export const EVAL_ALERT_SCRIM_CLASSES = 'fixed inset-0 z-50 flex items-center justify-center bg-eval-scrim p-5.5';
export const EVAL_ALERT_ICON_DANGER_CLASSES =
  'grid size-14 place-items-center rounded-eval-card bg-eval-danger-tint text-eval-danger [&_svg]:size-7';
export const EVAL_ALERT_EYEBROW_DANGER_CLASSES =
  'm-0 mt-4 text-[0.78rem] font-bold tracking-[0.05em] text-eval-danger uppercase';
/** The title when there is no eyebrow above it. */
export const EVAL_ALERT_TITLE_ALONE_CLASSES = 'm-0 mt-4 text-eval-dialog font-bold';
export const EVAL_ALERT_EXTRA_CLASSES = 'mt-3';
