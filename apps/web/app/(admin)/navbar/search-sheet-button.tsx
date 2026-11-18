'use client';

import { useState } from 'react';
import { useI18n } from '../../../lib/i18n';
import { IconButton } from '../../../components/icon-button';
import { Modal } from '../../../components/modal';
import { SearchCommand } from './search-command';

/**
 * The platform owner's global search below md, where the header has no room for the field: a search button
 * that opens the same combobox in a full-screen sheet (layout.md › keep functionality the same as the size
 * class changes; searching.md). Picking a result navigates and closes the sheet.
 */
export function SearchSheetButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton
        label={t.nav.openSearch}
        variant="chrome"
        size="sm"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      </IconButton>
      {open && (
        <Modal title={t.nav.searchSheetTitle} onClose={() => setOpen(false)} fullScreenOnMobile>
          <SearchCommand inSheet onPick={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}
