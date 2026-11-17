// The candidate dashboard's page structure in the TIMS evaluation design (the PCA respondent app; round 5 brief,
// decision 3). Inside the one white sheet: the eyebrow and the serif greeting, then each section as a block under a
// divider with a serif h2 (r-title-2) and, where it has one, a lead line; the things inside a section (one application,
// interview, offer, test) are PCA bordered panels with a title3. Recipes are composed from eval-styles.ts.
import {
  EVAL_CAPTION_CLASSES,
  EVAL_EYEBROW_CLASSES,
  EVAL_FACT_LABEL_CLASSES,
  EVAL_FACT_VALUE_CLASSES,
  EVAL_LEAD_CLASSES,
  EVAL_PANEL_CLASSES,
  EVAL_SUBHEAD_CLASSES,
  EVAL_TILE_CLASSES,
  EVAL_TILE_GRID_CLASSES,
  EVAL_TITLE_2_CLASSES,
  EVAL_TITLE_3_CLASSES,
  EVAL_TITLE_CLASSES,
} from './eval-styles';

/** "Portal del candidato": the eyebrow over the greeting. */
export const DASHBOARD_EYEBROW = EVAL_EYEBROW_CLASSES;
/** "Hola, {name}": the page's h1 (r-title). */
export const DASHBOARD_GREETING = `${EVAL_TITLE_CLASSES} mt-2`;
/** The list of sections under the greeting. */
export const DASHBOARD_SECTIONS = 'mt-6 flex flex-col gap-8 md:mt-8 md:gap-10';

/** One section (<section>): a block under a PCA divider, generous room above its title. */
export const DASHBOARD_CARD = 'min-w-0 border-t border-eval-divider pt-6 md:pt-8';
/** A section's h2 (r-title-2) with the room under it, when no lead line follows. */
export const DASHBOARD_TITLE = `${EVAL_TITLE_2_CLASSES} mb-4`;
/** A section's h2 when a lead line follows it (put DASHBOARD_LEAD right after). */
export const DASHBOARD_HEADING = EVAL_TITLE_2_CLASSES;
/** A section's lead line (r-lead) under its h2, and the room before the content. */
export const DASHBOARD_LEAD = `${EVAL_LEAD_CLASSES} mt-1.5 mb-4`;
/** "You have no scheduled interviews.": a section's empty line. */
export const DASHBOARD_EMPTY = EVAL_SUBHEAD_CLASSES;

/** The list of things in a section (<ul>). */
export const DASHBOARD_LIST = 'm-0 flex list-none flex-col gap-3 p-0';
/** One thing in a section (an application, an interview, an offer, a test): a PCA bordered panel. */
export const DASHBOARD_ITEM = EVAL_PANEL_CLASSES;
/** A panel's title (title3). */
export const DASHBOARD_ITEM_TITLE = EVAL_TITLE_3_CLASSES;
/** A panel's meta line ("TIMS Colombia", "Applied on …"). */
export const DASHBOARD_ITEM_META = `${EVAL_CAPTION_CLASSES} mt-1`;
/** A panel's header row: title block on the left, the status chip on the right (stacked on phones). */
export const DASHBOARD_ITEM_HEAD = 'flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3';

/** Label / value facts (my details, an offer's terms): PCA FactTiles. */
export const DASHBOARD_FACTS = EVAL_TILE_GRID_CLASSES;
export const DASHBOARD_FACT = EVAL_TILE_CLASSES;
export const DASHBOARD_FACT_LABEL = EVAL_FACT_LABEL_CLASSES;
export const DASHBOARD_FACT_VALUE = EVAL_FACT_VALUE_CLASSES;

/** The no-candidate state block under the greeting (PCA state screen, inside the sheet). */
export const DASHBOARD_STATE = 'mt-6 flex flex-col items-start border-t border-eval-divider pt-6 md:mt-8 md:pt-8';
export const DASHBOARD_STATE_TITLE = `${EVAL_TITLE_2_CLASSES} mt-5`;
export const DASHBOARD_STATE_LEAD = `${EVAL_LEAD_CLASSES} mt-2.5 max-w-prose`;
export const DASHBOARD_STATE_ACTION = 'mt-6 self-stretch md:self-start';
