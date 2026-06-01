'use client';

import { use } from 'react';
import { OrgDetail } from './org-detail';

export default function OrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <OrgDetail id={id} />;
}
