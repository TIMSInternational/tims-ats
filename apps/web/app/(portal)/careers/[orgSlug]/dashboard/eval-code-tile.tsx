import { EVAL_CODE_TILE_CLASSES, EVAL_CODE_TILE_SIZES, type EvalCodeTileSize } from './eval-control-styles';

/**
 * [compose] An instrument's short code ("LIA", "EN", "PCA") as a soft PCA tile: bg3, mono, ink2, radius 8. Decorative:
 * the instrument's name is written next to it. md = 40px (a test still to take), sm = 32px (a finished one).
 */
export function EvalCodeTile({ code, size = 'md' }: { code: string; size?: EvalCodeTileSize }) {
  return (
    <span aria-hidden="true" className={`${EVAL_CODE_TILE_CLASSES} ${EVAL_CODE_TILE_SIZES[size]}`}>
      {code}
    </span>
  );
}
