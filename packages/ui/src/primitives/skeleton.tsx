import * as React from "react";
import { cn } from "../lib/utils";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "circular" | "text";
  width?: string | number;
  height?: string | number;
  lines?: number;
}

function Skeleton({ className, variant = "default", width, height, lines, style, ...props }: SkeletonProps) {
  const baseStyle: React.CSSProperties = {
    ...(width !== undefined ? { width: typeof width === "number" ? `${width}px` : width } : {}),
    ...(height !== undefined ? { height: typeof height === "number" ? `${height}px` : height } : {}),
    ...style,
  };

  if (variant === "text" && lines && lines > 1) {
    return (
      <div className={cn("space-y-2", className)} {...props}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            style={{
              ...baseStyle,
              width: i === lines - 1 ? "75%" : baseStyle.width,
            }}
            className="h-4 animate-pulse rounded-md bg-muted"
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "animate-pulse bg-muted",
        variant === "circular" ? "rounded-full" : "rounded-md",
        variant === "text" && "h-4",
        className
      )}
      style={baseStyle}
      {...props}
    />
  );
}

export { Skeleton };
