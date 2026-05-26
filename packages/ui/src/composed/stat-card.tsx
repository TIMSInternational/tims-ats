import * as React from "react";
import { cn } from "../lib/utils";
import { MetricChange } from "./metric-change";

export interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeType?: "positive" | "negative" | "neutral";
  icon?: React.ReactNode;
  description?: string;
  className?: string;
}

export function StatCard({
  title,
  value,
  change,
  changeType,
  icon,
  description,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card text-card-foreground shadow-sm p-6 flex flex-col gap-4",
        className
      )}
    >
      {/* Header: title + icon */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        {icon && (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">
            {icon}
          </div>
        )}
      </div>

      {/* Value */}
      <div className="flex flex-col gap-1">
        <span className="text-3xl font-bold tracking-tight text-foreground">
          {value}
        </span>

        {/* Change indicator */}
        {change !== undefined && (
          <div className="flex items-center gap-1.5">
            <MetricChange value={change} type={changeType} />
            {description && (
              <span className="text-xs text-muted-foreground">{description}</span>
            )}
          </div>
        )}

        {/* Description without change */}
        {change === undefined && description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}
