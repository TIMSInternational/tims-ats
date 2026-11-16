// The frame around an embedded TIMS test, in the TIMS evaluation design (the PCA respondent app: navy page and header,
// "TIMS International" + the 3×3 mark, white sheet, blue accent, system fonts) so that the frame and the test inside it
// read as ONE screen. The class lists are the PCA app's own recipes (frame.tsx, primitives.tsx) on the `eval-*` tokens
// in globals.css. They live here, never inline in ternaries, so the i18n scanner never reads them as copy.

/** The full-screen dialog: the navy page every test screen sits on. */
export const FRAME_ROOT_CLASSES =
  'fixed inset-0 z-50 flex flex-col bg-eval-navy font-eval-sans text-eval-ink antialiased';

/** The PCA header: 56px / 68px, white text on navy, no divider under it (the test's own navy page continues it).
 * `tims-chrome` turns the global focus ring white on the navy. */
export const FRAME_HEADER_CLASSES =
  'tims-chrome flex h-14 shrink-0 items-center justify-between gap-3 px-4.5 text-eval-on-navy md:h-17 md:px-14';
export const FRAME_HEADER_START_CLASSES = 'flex min-w-0 items-center gap-3.5';
export const FRAME_HEADER_END_CLASSES = 'flex shrink-0 items-center gap-2 md:gap-4';
/** "TIMS International": the mark always, the word from md (a phone keeps its room for the test's name). */
export const FRAME_WORDMARK_CLASSES =
  'inline-flex shrink-0 items-center gap-2 font-semibold tracking-[0.03em] whitespace-nowrap text-eval-sm text-eval-on-navy';
export const FRAME_WORDMARK_TEXT_CLASSES = 'hidden md:inline';
export const FRAME_MARK_CLASSES = 'grid size-[18px] shrink-0 grid-cols-3 gap-[2px]';
/** Row-major cell colours of the TIMS mark. */
export const FRAME_MARK_CELLS = [
  'bg-eval-mark-1',
  'bg-eval-mark-2',
  'bg-eval-mark-3',
  'bg-eval-mark-4',
  'bg-eval-mark-3',
  'bg-eval-mark-5',
  'bg-eval-mark-5',
  'bg-eval-mark-5',
  'bg-eval-mark-6',
] as const;
export const FRAME_MARK_CELL_CLASSES = 'rounded-[1px]';
export const FRAME_DIVIDER_CLASSES = 'h-[22px] w-px shrink-0 bg-eval-on-navy-line';
/** The test's name: secondary header text. */
export const FRAME_TITLE_CLASSES = 'm-0 min-w-0 truncate text-eval-sm text-eval-on-navy-2 md:text-eval-base';

const HEADER_CONTROL =
  'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-eval-btn text-eval-base font-semibold whitespace-nowrap transition-colors motion-reduce:transition-none [&_svg]:size-5 [&_svg]:shrink-0';
/** "Abrir en una pestaña nueva": the PCA's navy icon button; the label is visible from sm. */
export const FRAME_NEW_TAB_CLASSES = `${HEADER_CONTROL} px-2.5 text-eval-on-navy hover:bg-eval-on-navy-hover`;
export const FRAME_NEW_TAB_LABEL_CLASSES = 'max-sm:sr-only';
/** "Salir" during a test: outlined on navy, like the PCA's unselected header chip. */
export const FRAME_LEAVE_CLASSES = `${HEADER_CONTROL} border border-eval-on-navy-border px-3.5 text-eval-on-navy hover:bg-eval-on-navy-hover`;
/** "Volver a mis evaluaciones" after the end: the one way back, filled white like the PCA's selected header chip. */
export const FRAME_DONE_CLASSES = `${HEADER_CONTROL} bg-white px-4 text-eval-heading hover:bg-eval-bg2`;

/** Where the test is drawn: the frame fills it, on the navy page. */
export const FRAME_BODY_CLASSES = 'relative min-h-0 flex-1';
export const FRAME_IFRAME_CLASSES = 'absolute inset-0 size-full border-0';
/** Until the page has loaded: the PCA sheet (full bleed on phones; inset 56px and 20px from the bottom on md) with a
 * spinner and what is opening. Never catches a click. */
export const FRAME_LOADING_CLASSES = 'pointer-events-none absolute inset-0 flex md:px-14 md:pb-5';
export const FRAME_LOADING_SHEET_CLASSES =
  'flex flex-1 flex-col items-center justify-center gap-4 rounded-t-eval-sheet bg-white px-6 text-center md:rounded-eval-sheet';
export const FRAME_SPINNER_CLASSES = 'size-11 text-eval-accent';
export const FRAME_LOADING_TEXT_CLASSES = 'm-0 text-eval-base leading-[1.55] text-eval-ink2';

/** "¿Salir de la evaluación?": the PCA AlertDialog over the scrim, centred, the warn icon tile on top. */
export const LEAVE_SCRIM_CLASSES = 'absolute inset-0 z-10 flex items-center justify-center bg-eval-scrim p-5.5';
export const LEAVE_PANEL_CLASSES =
  'w-full max-w-[520px] animate-sheet-up rounded-eval-sheet motion-reduce:animate-none bg-white px-5 pt-6 pb-4 text-eval-ink shadow-eval-pop md:p-8';
export const LEAVE_ICON_CLASSES =
  'grid size-14 place-items-center rounded-eval-card bg-eval-warn-tint text-eval-warn [&_svg]:size-7';
export const LEAVE_TITLE_CLASSES = 'm-0 mt-4 text-eval-dialog font-bold text-eval-heading';
export const LEAVE_BODY_CLASSES = 'm-0 mt-2 text-eval-base leading-[1.55] text-eval-ink2';
/** Phones: stacked full width, staying on top. md: one row, trailing. */
export const LEAVE_ACTIONS_CLASSES = 'mt-6 flex flex-col-reverse gap-2.5 md:flex-row md:justify-end md:gap-3';
const DIALOG_BUTTON =
  'inline-flex min-h-13 items-center justify-center gap-2 rounded-eval-btn px-5 text-center text-eval-md font-semibold leading-tight transition-colors motion-reduce:transition-none md:min-h-12 md:text-eval-base';
export const LEAVE_CONFIRM_CLASSES = `${DIALOG_BUTTON} border border-eval-line bg-white text-eval-ink hover:bg-eval-bg2`;
export const LEAVE_STAY_CLASSES = `${DIALOG_BUTTON} bg-eval-accent text-white hover:bg-eval-accent-hover`;
