'use client';

import { useI18n } from '../../../../lib/i18n';
import { PageHeader } from '../../../../components';
import { DeiKpis } from './dei-kpis';
import { GenderByDepartment, PayEquityTable } from './dei-left-column';
import { AgeDistribution, NationalityDiversity, HiringFunnel } from './dei-right-column';
import { PromotionEquity, LeadershipDiversity } from './dei-bottom-row';

export default function DeiPage() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      <PageHeader title={t.sidebar.dei} description={t.dei.pageDescription} />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <DeiKpis />

        {/* Cards in reading order on one two-column grid, so rows line up (the KPI row carries the inclusion index). */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <GenderByDepartment />
          <PayEquityTable />
          <AgeDistribution />
          <NationalityDiversity />
          <HiringFunnel />
          <PromotionEquity />
          <LeadershipDiversity />
        </div>
      </div>
    </div>
  );
}
