'use client';

import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  message: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, message, description, action }: EmptyStateProps) {
  return (
    <div className="px-5 py-16 text-center">
      <div className="flex justify-center mb-3">{icon}</div>
      <p className="text-sm text-[#8B8B8B]">{message}</p>
      {description && (
        <p className="text-xs text-[#8B8B8B] mt-1">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 h-9 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
