'use client';

import React, { useEffect, useRef } from 'react';
import { CountBadge } from './count-badge';

export interface TabItem {
  id: string;
  label: string;
  /** Optional neutral count ("Documentos 3"). */
  count?: number;
}

interface TabsProps {
  /** The tablist's accessible name ("Secciones del candidato"). */
  label: string;
  tabs: readonly TabItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Prefix for the tab and panel ids; pair with <TabPanel idPrefix=… tabId=…>. */
  idPrefix: string;
  className?: string;
}

export const tabId = (idPrefix: string, id: string) => `${idPrefix}-tab-${id}`;
export const tabPanelId = (idPrefix: string, id: string) => `${idPrefix}-panel-${id}`;

/**
 * Tabs switch sections of one page or record (foundation-spec.md §11, segmented-controls.md › Desktop:
 * "Use a tab view in the main window area"). Roving tabindex; arrows, Home and End move and select. Below sm
 * the row scrolls and keeps the selected tab in view. Never hide a tab because its section is empty.
 */
export function Tabs({ label, tabs, selectedId, onSelect, idPrefix, className = '' }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    selected?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selectedId]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = tabs.findIndex((tab) => tab.id === selectedId);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === -1) return;
    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onSelect(target.id);
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(idPrefix, target.id))}`)?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`scrollbar-hide flex gap-1 overflow-x-auto border-b border-border ${className}`}
    >
      {tabs.map((tab) => {
        const selected = tab.id === selectedId;
        return (
          <button
            key={tab.id}
            id={tabId(idPrefix, tab.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            className="-mb-px inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 text-body text-secondary transition-colors duration-150 hover:text-brand aria-selected:border-brand aria-selected:font-semibold aria-selected:text-brand pointer-coarse:min-h-11"
          >
            {tab.label}
            {tab.count !== undefined && <CountBadge count={tab.count} tone="neutral" showZero />}
          </button>
        );
      })}
    </div>
  );
}
