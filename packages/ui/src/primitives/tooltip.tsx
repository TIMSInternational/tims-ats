import * as React from "react";
import { cn } from "../lib/utils";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  contentClassName?: string;
  delayMs?: number;
}

const sideClasses = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

const arrowClasses = {
  top: "top-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-popover",
  bottom: "bottom-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-popover",
  left: "left-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-popover",
  right: "right-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-popover",
};

function Tooltip({
  content,
  children,
  side = "top",
  className,
  contentClassName,
}: TooltipProps) {
  return (
    <span
      className={cn("relative inline-flex", className)}
      data-tooltip-side={side}
    >
      <span className="group/tooltip inline-flex">
        {children}
        <span
          role="tooltip"
          className={cn(
            "pointer-events-none absolute z-50 w-max max-w-xs rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md",
            "opacity-0 transition-opacity duration-150",
            "group-hover/tooltip:opacity-100",
            sideClasses[side],
            contentClassName
          )}
        >
          {content}
          <span
            className={cn(
              "absolute h-0 w-0 border-4",
              arrowClasses[side]
            )}
          />
        </span>
      </span>
    </span>
  );
}

export interface TooltipProviderProps {
  children: React.ReactNode;
  delayDuration?: number;
}

// No-op provider for API compatibility
function TooltipProvider({ children }: TooltipProviderProps) {
  return <>{children}</>;
}

function TooltipTrigger({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function TooltipContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded-md bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md",
        className
      )}
    >
      {children}
    </span>
  );
}

export { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent };
