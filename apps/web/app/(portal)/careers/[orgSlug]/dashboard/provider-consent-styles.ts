// The consent guide inside a test's panel in the TIMS evaluation design (round 5 brief, decision 4): the PCA SheetHead
// (eyebrow + progress) over one step at a time, the step as title3 + r-lead + "Read the full text" + the PCA checkbox
// row, the review as a PCA StepList, and the full text in the PCA bottom sheet. Recipes composed from eval-styles.ts and
// eval-control-styles.ts. Constants only (never a class list in a ternary), and in a .ts file because some selectors
// carry a `>` the i18n scanner would read as the start of JSX text in a .tsx file.
import { EVAL_STEP_LIST_CLASSES } from './eval-control-styles';
import { EVAL_HINT_CLASSES, EVAL_LEAD_CLASSES, EVAL_SKELETON_CLASSES } from './eval-styles';

// ─── The guide ──────────────────────────────────────────────────────────────────────────────────

/** The guide under the test's head: a PCA divider, then the step head, the step, the hint and the actions. */
export const CONSENT_GUIDE_CLASSES =
  'mt-4 flex flex-col gap-4 border-t border-eval-divider pt-4 md:mt-5 md:gap-5 md:pt-5';
/** The step's wrapper, focused (tabIndex -1) after Back / Continue: the PCA ring follows its radius. */
export const CONSENT_STEP_FOCUS_CLASSES = 'rounded-eval-btn';
/** "Tick the box to continue.": a PCA hint over the actions it explains (right-aligned with them from md). */
export const CONSENT_WAITING_HINT_CLASSES = `${EVAL_HINT_CLASSES} md:text-right`;

// ─── One step ───────────────────────────────────────────────────────────────────────────────────

/** The step: title row, its line, "Read the full text" (its own width), the checkbox row (the full width). */
export const CONSENT_STEP_CLASSES = 'flex min-w-0 flex-col items-start';
/** The title (title3) and, on an optional step, the "Optional" chip beside it. */
export const CONSENT_STEP_TITLE_ROW_CLASSES = 'flex flex-wrap items-center gap-x-2.5 gap-y-1.5';
/** The step's one neutral line (r-lead). */
export const CONSENT_STEP_LINE_CLASSES = `${EVAL_LEAD_CLASSES} mt-1.5`;
/** "Read the full text": a compact secondary button with the FileText icon. */
export const CONSENT_STEP_READ_CLASSES = 'mt-3.5';
/** The PCA checkbox row, across the step. */
export const CONSENT_STEP_CHECK_CLASSES = 'mt-3 self-stretch';

// ─── The review ("Start") ───────────────────────────────────────────────────────────────────────

export const CONSENT_REVIEW_CLASSES = 'flex min-w-0 flex-col';
export const CONSENT_REVIEW_LINE_CLASSES = `${EVAL_LEAD_CLASSES} mt-1.5`;
/** The choices as a PCA StepList in a bordered panel. */
export const CONSENT_REVIEW_LIST_CLASSES = `${EVAL_STEP_LIST_CLASSES} mt-4`;
/** The optional consents, under their own (smaller) heading. */
export const CONSENT_REVIEW_OPTIONAL_CLASSES = 'mt-5 flex flex-col';
export const CONSENT_REVIEW_OPTIONAL_TITLE_CLASSES = 'm-0 text-eval-base leading-[1.4] font-semibold text-eval-heading';
export const CONSENT_REVIEW_OPTIONAL_LIST_CLASSES = `${EVAL_STEP_LIST_CLASSES} mt-2.5`;
export const CONSENT_REVIEW_OPTIONAL_INTRO_CLASSES = `${EVAL_HINT_CLASSES} mt-2.5`;

// ─── The full text (in the PCA sheet) ───────────────────────────────────────────────────────────

/** The focusable text container: the sheet's PCA ring follows its radius. */
export const CONSENT_FULL_TEXT_CLASSES = 'rounded-eval-btn';
/** One provider text, block by block: 15px / 1.55 ink sans (the sheet sets it), blocks 12px apart. */
export const CONSENT_TEXT_CLASSES = 'flex flex-col gap-3';
/** A heading inside the text: under the sheet's title3, so one step down (15px semibold, heading navy). */
export const CONSENT_TEXT_HEADING_CLASSES = 'm-0 pt-1 text-eval-base leading-[1.4] font-semibold text-eval-heading';
export const CONSENT_TEXT_PARAGRAPH_CLASSES = 'm-0';
export const CONSENT_TEXT_LIST_CLASSES: Record<'ordered' | 'unordered', string> = {
  ordered: 'm-0 list-decimal space-y-1 pl-5 marker:text-eval-ink2',
  unordered: 'm-0 list-disc space-y-1 pl-5 marker:text-eval-ink2',
};
/** A note inside the text: the PCA Callout shape (radius 8, toned icon), the text kept at reading size. */
export const CONSENT_TEXT_NOTE_CLASSES: Record<'warning' | 'info', string> = {
  warning:
    'm-0 flex items-start gap-2.5 rounded-eval-btn bg-eval-warn-tint px-3.5 py-3 text-eval-ink [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-eval-warn',
  info: 'm-0 flex items-start gap-2.5 rounded-eval-btn bg-eval-bg2 px-3.5 py-3 text-eval-ink [&>svg]:mt-0.5 [&>svg]:size-5 [&>svg]:shrink-0 [&>svg]:text-eval-accent',
};

/**
 * The ATS notice (components/assessment-consent-notice.tsx, shared with the staff dialog, so not edited here) inside the
 * PCA sheet: these descendant selectors outrank its ATS type classes (one class + one element beats one class), so it
 * reads in the sheet's 15px / 1.55 ink with 15px semibold headings and a 12px ink2 version line, like a provider text.
 */
export const CONSENT_NOTICE_CLASSES = [
  '[&_section]:text-eval-base [&_section]:leading-[1.55] [&_section]:text-eval-ink',
  '[&_h3]:text-eval-base [&_h3]:leading-[1.4] [&_h3]:text-eval-heading [&_section>div]:pt-1 [&_section_div>h3]:mb-1',
  '[&_section>p:last-child]:pt-1 [&_section>p:last-child]:text-eval-xs [&_section>p:last-child]:text-eval-ink2',
].join(' ');

// ─── Loading the texts ──────────────────────────────────────────────────────────────────────────

/** Placeholder blocks in the shape of the step head, a step title and the checkbox row. */
export const CONSENT_SKELETON_EYEBROW_CLASSES = `${EVAL_SKELETON_CLASSES} h-3 w-1/3`;
export const CONSENT_SKELETON_BAR_CLASSES =
  'h-[5px] w-full animate-pulse rounded-full bg-eval-bg3 motion-reduce:animate-none md:h-1.5';
export const CONSENT_SKELETON_TITLE_CLASSES = `${EVAL_SKELETON_CLASSES} h-[18px] w-1/2`;
export const CONSENT_SKELETON_ROW_CLASSES =
  'h-[50px] w-full animate-pulse rounded-xl bg-eval-bg3 motion-reduce:animate-none';
/** The way out under a texts load error ("Cancel"), its own width. */
export const CONSENT_ERROR_CANCEL_CLASSES = 'self-start';
