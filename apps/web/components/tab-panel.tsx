'use client';

import React from 'react';
import { tabId, tabPanelId } from './tabs';

/** The region a Tabs tab controls. Render only the selected panel, or all with `hidden` on the others. */
export function TabPanel({
  idPrefix,
  tabId: id,
  hidden,
  className = '',
  children,
}: {
  idPrefix: string;
  tabId: string;
  hidden?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(idPrefix, id)}
      aria-labelledby={tabId(idPrefix, id)}
      hidden={hidden}
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  );
}
