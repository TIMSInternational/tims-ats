import {
  FRAME_MARK_CELLS,
  FRAME_MARK_CELL_CLASSES,
  FRAME_MARK_CLASSES,
  FRAME_WORDMARK_CLASSES,
  FRAME_WORDMARK_TEXT_CLASSES,
} from './provider-frame-styles';

// "TIMS International" as the PCA app draws it in its navy header: the 3×3 mark (nine CSS cells, no image file) and the
// live wordmark. The mark is decoration; the word is hidden below md, where the test's name needs the room.
export function ProviderFrameBrand({ label }: { label: string }) {
  return (
    <span className={FRAME_WORDMARK_CLASSES}>
      <span aria-hidden="true" className={FRAME_MARK_CLASSES}>
        {FRAME_MARK_CELLS.map((cell, index) => (
          <span key={index} className={`${cell} ${FRAME_MARK_CELL_CLASSES}`} />
        ))}
      </span>
      <span className={FRAME_WORDMARK_TEXT_CLASSES}>{label}</span>
    </span>
  );
}
