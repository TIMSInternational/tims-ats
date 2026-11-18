'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '../lib/i18n';
import { useDismissable } from '../lib/use-dismissable';

export type MenuEntry =
  | {
      key: string;
      label: string;
      /** Run on select. Items that open a dialog end their label with "…" (menus.md › Labels). */
      onSelect?: () => void;
      /** Or navigate. */
      href?: string;
      /** Red text: the item destroys something; confirm it in a ConfirmDialog. */
      destructive?: boolean;
      disabled?: boolean;
      icon?: React.ReactNode;
    }
  | { key: string; type: 'separator' };

interface MenuProps {
  items: readonly MenuEntry[];
  /** The trigger's accessible name. Defaults to t.common.moreActions ("Más acciones"). */
  label?: string;
  /** Visible trigger content. Defaults to a "⋯" icon (an IconButton-sized trigger). */
  trigger?: React.ReactNode;
  /** Classes for the trigger button; replaces the default icon-button look. */
  triggerClassName?: string;
  /** A single-choice menu (language, sort): items become menuitemradio with a check on the chosen key. */
  selectedKey?: string;
  align?: 'start' | 'end';
  placement?: 'bottom' | 'top';
  /** Called when the menu opens (e.g. to close sibling popovers). */
  onOpenChange?: (open: boolean) => void;
  /** Extra classes for the panel (e.g. a width). */
  panelClassName?: string;
}

const BELOW = 'sm:top-full sm:mt-1';
const ABOVE = 'sm:bottom-full sm:mb-1';
const ICON_TRIGGER =
  'inline-flex size-9 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface hover:text-primary pointer-coarse:size-11';

type ActionEntry = Extract<MenuEntry, { label: string }>;
const isAction = (entry: MenuEntry): entry is ActionEntry => !('type' in entry);
const itemsIn = (menu: HTMLElement | null): HTMLElement[] =>
  Array.from(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);

/**
 * Pull-down menu (foundation-spec.md §9, pull-down-buttons.md): ≤7 commands or one small choice. Arrow keys,
 * Home/End and typeahead move; Enter selects; Escape and outside clicks close and return focus. Below sm it
 * opens as a bottom sheet (popovers.md › Mobile).
 */
export function Menu({
  items,
  label,
  trigger,
  triggerClassName,
  selectedKey,
  align = 'end',
  placement = 'bottom',
  onOpenChange,
  panelClassName = 'w-56',
}: MenuProps) {
  const { t } = useI18n();
  const [open, setOpenState] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `menu-${useId()}`;
  const choice = selectedKey !== undefined;

  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  useDismissable(open, wrapRef, () => setOpen(false), triggerRef);

  const enabledItems = () => itemsIn(menuRef.current);

  // Focus the chosen item (or the first one) when the menu opens.
  useEffect(() => {
    if (!open) return;
    const list = itemsIn(menuRef.current);
    (list.find((el) => el.getAttribute('aria-checked') === 'true') ?? list[0])?.focus();
  }, [open]);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const list = enabledItems();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(list.length - 1);
    else if (event.key === 'Tab') setOpen(false);
    else if (event.key.length === 1 && /\S/.test(event.key)) {
      const letter = event.key.toLowerCase();
      const found = list.findIndex((el, i) => i > index && el.textContent?.trim().toLowerCase().startsWith(letter));
      const wrap =
        found === -1 ? list.findIndex((el) => el.textContent?.trim().toLowerCase().startsWith(letter)) : found;
      if (wrap !== -1) move(wrap);
    }
  };

  const select = (item: ActionEntry) => {
    if (item.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    item.onSelect?.();
  };

  const position = `${align === 'end' ? 'sm:right-0' : 'sm:left-0'} ${placement === 'bottom' ? BELOW : ABOVE}`;
  const itemClass = (item: ActionEntry) =>
    `flex w-full items-center gap-2 rounded-md px-3 text-left text-body min-h-8 pointer-coarse:min-h-11 transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${
      item.destructive ? 'text-brand-red hover:bg-danger-bg' : 'text-primary hover:bg-surface'
    }`;

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label ?? t.common.moreActions}
        title={trigger ? undefined : (label ?? t.common.moreActions)}
        onClick={() => setOpen(!open)}
        className={triggerClassName ?? ICON_TRIGGER}
      >
        {trigger ?? (
          <svg className="size-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1.75" />
            <circle cx="12" cy="12" r="1.75" />
            <circle cx="19" cy="12" r="1.75" />
          </svg>
        )}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 animate-fade-in sm:hidden"
          aria-hidden="true"
          onClick={() => setOpen(false)}
        />
      )}
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label ?? t.common.moreActions}
          onKeyDown={onMenuKeyDown}
          className={`tims-surface fixed inset-x-0 bottom-0 z-50 max-h-[70dvh] overflow-y-auto rounded-t-2xl border border-border bg-white p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] shadow-popover animate-sheet-up sm:absolute sm:inset-x-auto sm:bottom-auto sm:max-h-80 sm:rounded-xl sm:pb-1 ${position} ${panelClassName}`}
        >
          {items.map((item) => {
            if (!isAction(item)) return <div key={item.key} role="separator" className="my-1 h-px bg-border" />;
            const checked = choice ? item.key === selectedKey : undefined;
            const common = {
              role: choice ? 'menuitemradio' : 'menuitem',
              'aria-checked': checked,
              'aria-disabled': item.disabled || undefined,
              tabIndex: -1,
              className: itemClass(item),
            } as const;
            const content = (
              <>
                {item.icon && (
                  <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {checked && (
                  <svg
                    className="size-4 shrink-0 text-brand"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </>
            );
            return item.href && !item.disabled ? (
              <Link key={item.key} href={item.href} {...common} onClick={() => select(item)}>
                {content}
              </Link>
            ) : (
              <button key={item.key} type="button" {...common} onClick={() => select(item)}>
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
