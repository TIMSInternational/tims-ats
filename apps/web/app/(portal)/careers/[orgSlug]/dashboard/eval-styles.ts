// The candidate dashboard in the TIMS evaluation design (the PCA respondent app, PCA-DESIGN.md): the page, the sheet,
// the type roles and the panels. Every class list is the PCA app's own recipe (respondent.css, primitives.tsx,
// frame.tsx) on the `eval-*` tokens in globals.css. Class lists live in constants, never inline in ternaries, so the i18n
// scanner never reads them as copy. Controls (buttons, chips, fields, dialogs) are in eval-control-styles.ts.

// ─── Page ─────────────────────────────────────────────────────────────────────────────────────────

/** The navy page. The DOCUMENT scrolls (not the PCA's fixed inner scroller): the dashboard is long. `tims-eval` gives
 * the PCA focus ring (3px accent, white on the header); `tims-eval-page` turns the body navy for overscroll. */
export const EVAL_PAGE_CLASSES =
  'tims-eval tims-eval-page flex min-h-dvh flex-col bg-eval-navy font-eval-sans text-eval-ink antialiased';

/** The org logo in the header: the uploaded image, at the PCA's size. */
export const EVAL_ORG_LOGO_IMG_CLASSES =
  'block max-h-[30px] w-auto max-w-[140px] object-contain md:max-h-[34px] md:max-w-[180px]';
/** No logo: the PCA's dashed chip with the organization's name. */
export const EVAL_ORG_CHIP_CLASSES =
  'inline-flex h-[30px] max-w-[60vw] min-w-0 items-center overflow-hidden rounded-eval-chip border border-dashed border-eval-on-navy-dash px-2.5 text-eval-xs tracking-[0.04em] text-eval-on-navy-2 uppercase md:h-[34px] md:max-w-[320px] md:px-3.5 md:text-eval-sm';
/** The chip's name: one line, an ellipsis when it is long. */
export const EVAL_ORG_CHIP_TEXT_CLASSES = 'min-w-0 truncate';
/** The link around the org mark, back to the job board: a 44px target, the white ring of the header. */
export const EVAL_ORG_LINK_CLASSES = 'inline-flex min-h-11 min-w-0 shrink items-center rounded-eval-btn';

/** The white sheet: full bleed on phones (radius 16 16 0 0, runs to the bottom), inset 56px and 20px from the bottom
 * from md (radius 16). Padding 18 / 30 on top, 18 / 40 at the sides, and room at the end of a long page. */
export const EVAL_SHEET_CLASSES =
  'flex flex-1 flex-col rounded-t-eval-sheet bg-white px-4.5 pt-4.5 pb-12 md:mx-14 md:mb-5 md:rounded-eval-sheet md:px-10 md:pt-7.5 md:pb-14';
/** The content column: PCA "medium" (760px), centred. */
export const EVAL_COLUMN_CLASSES = 'mx-auto flex w-full min-w-0 max-w-[760px] flex-1 flex-col';
/** PCA "narrow" (640px): state screens. */
export const EVAL_COLUMN_NARROW_CLASSES = 'mx-auto flex w-full min-w-0 max-w-[640px] flex-1 flex-col';
/** A state screen's block (PCA StateLayout): top-aligned on phones, vertically centred from md. */
export const EVAL_STATE_CLASSES = 'flex flex-col md:my-auto';

// ─── Type roles ───────────────────────────────────────────────────────────────────────────────────

/** `.r-eyebrow`: 11px, 700, uppercase, .18em (.2em from md), ink2. */
export const EVAL_EYEBROW_CLASSES =
  'm-0 text-eval-eyebrow font-bold tracking-[0.18em] text-eval-ink2 uppercase md:tracking-[0.2em]';
/** `.r-title` (the page h1): Georgia 400, 26px → 34px, line-height 1.22, heading navy. */
export const EVAL_TITLE_CLASSES =
  'm-0 font-eval-serif text-eval-title font-normal break-words text-eval-heading md:text-eval-title-lg';
/** `.r-title-2` (a section h2): Georgia 400, 24px, line-height 1.25. */
export const EVAL_TITLE_2_CLASSES = 'm-0 font-eval-serif text-eval-title-2 font-normal break-words text-eval-heading';
/** `title3` (a panel's title): 17px semibold, line-height 1.3, heading navy. */
export const EVAL_TITLE_3_CLASSES = 'm-0 text-eval-lg leading-[1.3] font-semibold break-words text-eval-heading';
/** `.r-lead`: 15px, line-height 1.55, ink2. A section's or a state's line under its title. */
export const EVAL_LEAD_CLASSES = 'm-0 text-eval-base leading-[1.55] text-eval-ink2';
/** `subhead`: 15px ink2 (one line inside a panel). */
export const EVAL_SUBHEAD_CLASSES = 'm-0 text-eval-base text-eval-ink2';
/** Reading text (a consent's full text, an answer): 15px, line-height 1.55, ink, sans. */
export const EVAL_BODY_CLASSES = 'text-eval-base leading-[1.55] text-eval-ink';
/** `.r-hint`: 13px, line-height 1.45, ink2. */
export const EVAL_HINT_CLASSES = 'm-0 text-eval-sm leading-[1.45] text-eval-ink2';
/** `footnote`: 13px ink2. */
export const EVAL_FOOTNOTE_CLASSES = 'm-0 text-eval-sm text-eval-ink2';
/** `caption`: 12px ink2 (dates under a title, "Available until …"). */
export const EVAL_CAPTION_CLASSES = 'm-0 text-eval-xs text-eval-ink2';
/** A link inside copy (an email address, "Read the privacy notice"). */
export const EVAL_LINK_CLASSES =
  'font-medium text-eval-accent underline underline-offset-2 [overflow-wrap:anywhere] hover:text-eval-accent-hover';
/** A link that stands alone on its line: the PCA ghost action's look, a 44px target. */
export const EVAL_STANDALONE_LINK_CLASSES =
  'inline-flex min-h-11 items-center gap-1.5 self-start text-eval-base font-semibold text-eval-accent underline-offset-2 hover:underline [&_svg]:size-[18px] [&_svg]:shrink-0';

// ─── Panels and tiles ─────────────────────────────────────────────────────────────────────────────

/** A PCA bordered panel (thanks receipt box, landing "Así se responde"): one application, interview, offer, test. */
export const EVAL_PANEL_CLASSES =
  'rounded-eval-card border border-eval-line bg-white p-4 text-eval-ink shadow-eval-card md:p-5';
/** A soft tile (FactTiles): one label + value pair. */
export const EVAL_TILE_CLASSES =
  'flex min-w-0 flex-col gap-1 rounded-eval-btn bg-eval-bg2 px-3 py-2.5 md:px-3.5 md:py-3';
/** A grid of tiles: one column on phones, two from sm. */
export const EVAL_TILE_GRID_CLASSES = 'm-0 grid grid-cols-1 gap-2.5 sm:grid-cols-2';
/** FactTiles dt: 10px, bold, .12em, uppercase, ink2. */
export const EVAL_FACT_LABEL_CLASSES = 'm-0 text-eval-2xs font-bold tracking-[0.12em] text-eval-ink2 uppercase';
/** A fact's value in this portal: 15px ink, wraps (names and emails are not numbers). */
export const EVAL_FACT_VALUE_CLASSES = 'm-0 text-eval-base break-words text-eval-ink';
/** A fact's value that is a number or a date (PCA FactTiles dd): mono, heading navy. */
export const EVAL_FACT_NUMBER_CLASSES =
  'm-0 font-eval-mono text-eval-md whitespace-nowrap text-eval-heading md:text-eval-lg';
/** A hairline between blocks (`hr.r-divider`). */
export const EVAL_DIVIDER_CLASSES = 'm-0 h-px shrink-0 border-0 bg-eval-divider';
/** IconTile: a 28px soft tile with a 15px icon in ink2. */
export const EVAL_ICON_TILE_CLASSES =
  'grid size-7 shrink-0 place-items-center rounded-eval-btn bg-eval-bg3 text-eval-ink2 [&_svg]:size-[15px]';

// ─── Big icon (state screens) ────────────────────────────────────────────────────────────────────

export type EvalBigIconTone = 'neutral' | 'accent' | 'warn' | 'err' | 'ok';
/** BigIcon: a 56px tile, 28px icon. */
export const EVAL_BIG_ICON_CLASSES = 'grid size-14 shrink-0 place-items-center rounded-eval-card [&_svg]:size-7';
export const EVAL_BIG_ICON_TONES: Record<EvalBigIconTone, string> = {
  neutral: 'bg-eval-bg2 text-eval-ink2',
  accent: 'bg-eval-accent-tint text-eval-accent',
  warn: 'bg-eval-warn-tint text-eval-warn',
  err: 'bg-eval-danger-tint text-eval-danger',
  ok: 'bg-eval-ok-tint text-eval-ok',
};

// ─── Loading ─────────────────────────────────────────────────────────────────────────────────────

/** `.r-spin`: a 1.15em ring, 2.5px, open on the right, 0.9s linear (3s with reduced motion, see globals.css). */
export const EVAL_SPINNER_CLASSES =
  'inline-block size-[1.15em] shrink-0 animate-eval-spin rounded-full border-[2.5px] border-current border-r-transparent';
/** A skeleton block: soft, rounded, pulsing (still under reduced motion). Add the size: `${EVAL_SKELETON_CLASSES} h-4 w-2/3`. */
export const EVAL_SKELETON_CLASSES = 'animate-pulse rounded-eval-btn bg-eval-bg3 motion-reduce:animate-none';
