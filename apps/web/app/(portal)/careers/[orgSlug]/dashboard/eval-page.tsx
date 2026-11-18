'use client';

import type { ReactNode } from 'react';
import { EvalPageHeader } from './eval-page-header';
import { EVAL_COLUMN_CLASSES, EVAL_COLUMN_NARROW_CLASSES, EVAL_PAGE_CLASSES, EVAL_SHEET_CLASSES } from './eval-styles';

const COLUMN: Record<'medium' | 'narrow', string> = {
  medium: EVAL_COLUMN_CLASSES,
  narrow: EVAL_COLUMN_NARROW_CLASSES,
};

/**
 * The PCA shell for a candidate page (PCA-DESIGN §5), with the document scrolling: the navy page, the PCA header, one
 * white rounded sheet (<main>), and the content column inside it — medium (760px) for the dashboard, narrow (640px)
 * for a state screen. Covers the (portal) layout's white with navy (and globals.css turns the body navy for overscroll).
 */
export function EvalPage({
  orgSlug,
  orgName,
  orgLogo,
  headerEnd,
  width = 'medium',
  children,
}: {
  orgSlug: string;
  orgName: string | null;
  orgLogo: string | null | undefined;
  /** The header's right side ("Sign out"). */
  headerEnd?: ReactNode;
  width?: 'medium' | 'narrow';
  children: ReactNode;
}) {
  return (
    <div className={EVAL_PAGE_CLASSES}>
      <EvalPageHeader orgSlug={orgSlug} orgName={orgName} orgLogo={orgLogo}>
        {headerEnd}
      </EvalPageHeader>
      <main className={EVAL_SHEET_CLASSES}>
        <div className={COLUMN[width]}>{children}</div>
      </main>
    </div>
  );
}
