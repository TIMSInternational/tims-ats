import * as React from "react";
import { cn } from "../lib/utils";

export interface StatusBadgeProps {
  status: string;
  variant?: "default" | "positive" | "warning" | "negative" | "neutral" | "info";
  className?: string;
}

type ColorConfig = {
  container: string;
  dot: string;
};

const STATUS_COLOR_MAP: Record<string, ColorConfig> = {
  // Positive / green
  active:      { container: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800", dot: "bg-emerald-500" },
  open:        { container: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800", dot: "bg-emerald-500" },
  approved:    { container: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800", dot: "bg-emerald-500" },
  hired:       { container: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800", dot: "bg-emerald-500" },
  completed:   { container: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800", dot: "bg-emerald-500" },
  published:   { container: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800", dot: "bg-emerald-500" },

  // Warning / yellow
  pending:     { container: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800", dot: "bg-amber-500" },
  review:      { container: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800", dot: "bg-amber-500" },
  in_review:   { container: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800", dot: "bg-amber-500" },
  scheduled:   { container: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800", dot: "bg-amber-500" },
  on_hold:     { container: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800", dot: "bg-amber-500" },

  // Negative / red
  closed:      { container: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800", dot: "bg-red-500" },
  rejected:    { container: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800", dot: "bg-red-500" },
  expired:     { container: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800", dot: "bg-red-500" },
  terminated:  { container: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800", dot: "bg-red-500" },
  failed:      { container: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800", dot: "bg-red-500" },
  cancelled:   { container: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800", dot: "bg-red-500" },

  // Neutral / gray
  draft:       { container: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/50 dark:text-gray-400 dark:border-gray-700", dot: "bg-gray-400" },
  archived:    { container: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/50 dark:text-gray-400 dark:border-gray-700", dot: "bg-gray-400" },
  inactive:    { container: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/50 dark:text-gray-400 dark:border-gray-700", dot: "bg-gray-400" },

  // Info / blue
  in_progress: { container: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800", dot: "bg-blue-500" },
  applied:     { container: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800", dot: "bg-blue-500" },
  interviewing:{ container: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800", dot: "bg-blue-500" },
  offered:     { container: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800", dot: "bg-blue-500" },
};

const VARIANT_COLOR_MAP: Record<string, ColorConfig> = {
  positive: { container: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800", dot: "bg-emerald-500" },
  warning:  { container: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800", dot: "bg-amber-500" },
  negative: { container: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800", dot: "bg-red-500" },
  neutral:  { container: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/50 dark:text-gray-400 dark:border-gray-700", dot: "bg-gray-400" },
  info:     { container: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800", dot: "bg-blue-500" },
  default:  { container: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800/50 dark:text-gray-400 dark:border-gray-700", dot: "bg-gray-400" },
};

function resolveColors(status: string, variant?: StatusBadgeProps["variant"]): ColorConfig {
  if (variant && variant !== "default") {
    return VARIANT_COLOR_MAP[variant];
  }
  const normalized = status.toLowerCase().replace(/[\s-]/g, "_");
  return STATUS_COLOR_MAP[normalized] ?? VARIANT_COLOR_MAP["default"];
}

function formatLabel(status: string): string {
  return status
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({ status, variant, className }: StatusBadgeProps) {
  const colors = resolveColors(status, variant);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        colors.container,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", colors.dot)} />
      {formatLabel(status)}
    </span>
  );
}
