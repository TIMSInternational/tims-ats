'use client';

import React, { createContext, useContext } from 'react';
import { PageHeader } from '../../../components/page-header';

/**
 * Content a parent wants at the top of whichever role dashboard renders, under that dashboard's page
 * header (the org stewards' setup checklist). Before, it sat above the page's h1 and outside the scroll
 * container, so it permanently took ~290px on a phone or a short laptop.
 */
export const DashboardLeadContext = createContext<React.ReactNode>(null);

interface DashboardPageProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Secondary actions first, then the one primary trailing. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The frame every role dashboard shares (foundation-spec.md §10): the PageHeader with the page's single h1,
 * then one scrolling body with the standard padding. The lead slot (if any) opens the body.
 */
export function DashboardPage({ title, description, actions, children }: DashboardPageProps) {
  const lead = useContext(DashboardLeadContext);
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title={title} description={description} actions={actions} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        {lead && <div className="mb-6">{lead}</div>}
        {children}
      </div>
    </div>
  );
}
