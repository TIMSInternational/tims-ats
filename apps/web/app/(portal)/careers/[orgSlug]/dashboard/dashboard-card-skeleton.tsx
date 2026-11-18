import { DASHBOARD_ITEM, DASHBOARD_LIST } from './dashboard-styles';
import { EVAL_SKELETON_CLASSES } from './eval-styles';

// The skeleton blocks of one item, in the PCA look (soft bg3 blocks, radius 8), shaped like a panel's title, meta line
// and status chip. Constants, so no class list sits in JSX logic.
const ROW_CLASSES = 'flex items-start justify-between gap-3';
const TEXT_CLASSES = 'flex-1 space-y-2';
const TITLE_CLASSES = `${EVAL_SKELETON_CLASSES} h-[18px] w-2/3`;
const META_CLASSES = `${EVAL_SKELETON_CLASSES} h-3 w-1/3`;
const CHIP_CLASSES = `${EVAL_SKELETON_CLASSES} h-7 w-24 shrink-0 rounded-full`;

/**
 * Loading placeholder in the shape of a dashboard item (a PCA bordered panel: title, meta line, status chip), so the
 * section does not jump when the data arrives. `label` is the section's existing "Cargando…" string, read by screen
 * readers.
 */
export function DashboardCardSkeleton({ label, rows = 2 }: { label: string; rows?: number }) {
  return (
    <div aria-busy="true" className={DASHBOARD_LIST}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} aria-hidden="true" className={`${DASHBOARD_ITEM} ${ROW_CLASSES}`}>
          <div className={TEXT_CLASSES}>
            <div className={TITLE_CLASSES} />
            <div className={META_CLASSES} />
          </div>
          <div className={CHIP_CLASSES} />
        </div>
      ))}
    </div>
  );
}
