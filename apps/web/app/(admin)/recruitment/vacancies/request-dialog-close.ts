import type React from 'react';

/**
 * Sends a footer "Cancelar" through the enclosing Modal/Drawer's own close request, so it gets the same
 * "¿Descartar los cambios?" guard as the ✕, the backdrop and Escape (modality.md). It presses that dialog's
 * header ✕ (labelled `closeLabel`), which reaches only this dialog — unlike a synthetic Escape on document,
 * which every open dialog, menu and picker would also receive.
 *
 * TODO(cross-area recruitment-vacancies #1): replace with the foundation Modal/Drawer `requestClose` once it is
 * exposed to the footer.
 */
export function requestDialogClose(
  event: React.MouseEvent<HTMLElement>,
  closeLabel: string,
  fallback: () => void,
): void {
  const dialog = event.currentTarget.closest('[role="dialog"]');
  const closeButton = Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button[aria-label]') ?? []).find(
    (button) => button.getAttribute('aria-label') === closeLabel,
  );
  if (closeButton) closeButton.click();
  else fallback();
}
