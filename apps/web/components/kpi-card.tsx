'use client';

import React from 'react';
import { Skeleton } from './skeleton';

interface KpiCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  iconBg: string;
  highlight?: boolean;
  valueColor?: string;
}

export function KpiCard({
  label,
  value,
  subtitle,
  icon,
  iconBg,
  highlight,
  valueColor,
}: KpiCardProps) {
  return (
    <div
      className={`bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 ${
        highlight ? 'border border-red-200' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">
          {label}
        </span>
        <div
          className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center`}
        >
          {icon}
        </div>
      </div>
      <div className={`text-xl md:text-2xl font-bold ${valueColor || 'text-[#333]'}`}>
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-[#8B8B8B] mt-1">{subtitle}</div>
      )}
    </div>
  );
}

export function KpiCardSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 animate-pulse">
      <Skeleton className="h-3 w-24 mb-3" />
      <Skeleton className="h-7 w-16 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}
