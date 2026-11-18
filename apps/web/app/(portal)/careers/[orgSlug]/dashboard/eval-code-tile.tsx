import { EVAL_CODE_TILE_CLASSES } from './eval-control-styles';

/**
 * [compose] An instrument's short code ("LIA", "EN", "PCA") as a soft PCA tile: 40px, bg3, 12px mono, ink2, radius 8,
 * the same for every status. Decorative: the instrument's name is written next to it.
 */
export function EvalCodeTile({ code }: { code: string }) {
  return (
    <span aria-hidden="true" className={EVAL_CODE_TILE_CLASSES}>
      {code}
    </span>
  );
}
