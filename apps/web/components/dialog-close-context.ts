'use client';

import { createContext, useContext } from 'react';

/**
 * The dirty-guarded close of the enclosing Modal or Drawer (foundation-spec.md §9). A footer "Cancelar" that
 * calls it asks "¿Descartar los cambios?" exactly like ✕, Escape and the backdrop do.
 */
export const DialogCloseContext = createContext<(() => void) | null>(null);

/** The enclosing dialog's guarded close, or `fallback` when rendered outside a Modal/Drawer. */
export function useDialogClose(fallback: () => void): () => void {
  return useContext(DialogCloseContext) ?? fallback;
}
