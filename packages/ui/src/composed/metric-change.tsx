import * as React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "../lib/utils";

export interface MetricChangeProps {
  value: number;
  suffix?: string;
  type?: "positive" | "negative" | "neutral";
  className?: string;
}

export function MetricChange({
  value,
  suffix = "%",
  type,
  className,
}: MetricChangeProps) {
  // If no explicit type, derive from sign
  const resolvedType: "positive" | "negative" | "neutral" =
    type ?? (value > 0 ? "positive" : value < 0 ? "negative" : "neutral");

  const isPositive = resolvedType === "positive";
  const isNegative = resolvedType === "negative";

  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  const absValue = Math.abs(value);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        isPositive && "text-emerald-600 dark:text-emerald-400",
        isNegative && "text-red-600 dark:text-red-400",
        !isPositive && !isNegative && "text-muted-foreground",
        className
      )}
      aria-label={`${isPositive ? "Increase" : isNegative ? "Decrease" : "No change"} of ${absValue}${suffix}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {isPositive && "+"}
        {value}
        {suffix}
      </span>
    </span>
  );
}
