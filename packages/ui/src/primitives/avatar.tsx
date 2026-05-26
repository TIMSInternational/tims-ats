import * as React from "react";
import { cn } from "../lib/utils";

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

const sizeClasses = {
  xs: "h-6 w-6 text-xs",
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-16 w-16 text-lg",
};

function getInitials(fallback: string): string {
  return fallback
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className, src, alt, fallback, size = "md", ...props }, ref) => {
    const [imgError, setImgError] = React.useState(false);
    const showImage = src && !imgError;

    return (
      <span
        ref={ref}
        className={cn(
          "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-muted",
          sizeClasses[size],
          className
        )}
        {...props}
      >
        {showImage ? (
          <img
            src={src}
            alt={alt ?? fallback ?? "Avatar"}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : fallback ? (
          <span className="font-medium text-muted-foreground" aria-label={alt ?? fallback}>
            {getInitials(fallback)}
          </span>
        ) : (
          <svg
            className="h-[60%] w-[60%] text-muted-foreground"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
          </svg>
        )}
      </span>
    );
  }
);
Avatar.displayName = "Avatar";

const AvatarGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { max?: number }
>(({ className, children, max, ...props }, ref) => {
  const childArray = React.Children.toArray(children);
  const shown = max ? childArray.slice(0, max) : childArray;
  const hidden = max ? childArray.length - max : 0;

  return (
    <div
      ref={ref}
      className={cn("flex -space-x-2", className)}
      {...props}
    >
      {shown.map((child, i) => (
        <span key={i} className="ring-2 ring-background rounded-full">
          {child}
        </span>
      ))}
      {hidden > 0 && (
        <span className="ring-2 ring-background rounded-full inline-flex h-10 w-10 shrink-0 items-center justify-center bg-muted text-sm font-medium text-muted-foreground">
          +{hidden}
        </span>
      )}
    </div>
  );
});
AvatarGroup.displayName = "AvatarGroup";

export { Avatar, AvatarGroup };
