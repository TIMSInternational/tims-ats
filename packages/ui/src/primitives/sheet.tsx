"use client";

import * as React from "react";
import { cn } from "../lib/utils";
import { X } from "lucide-react";

interface SheetContextValue {
  open: boolean;
  onClose: () => void;
}

const SheetContext = React.createContext<SheetContextValue>({
  open: false,
  onClose: () => {},
});

export interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function Sheet({ open = false, onOpenChange, children }: SheetProps) {
  const onClose = React.useCallback(() => onOpenChange?.(false), [onOpenChange]);
  return (
    <SheetContext.Provider value={{ open, onClose }}>
      {children}
    </SheetContext.Provider>
  );
}

function useSheet() {
  return React.useContext(SheetContext);
}

export interface SheetContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: "left" | "right";
}

const sideVariants = {
  left: {
    panel: "inset-y-0 left-0 h-full w-3/4 max-w-sm border-r",
    enter: "translate-x-0",
    exit: "-translate-x-full",
  },
  right: {
    panel: "inset-y-0 right-0 h-full w-3/4 max-w-sm border-l",
    enter: "translate-x-0",
    exit: "translate-x-full",
  },
};

const SheetContent = React.forwardRef<HTMLDivElement, SheetContentProps>(
  ({ className, children, side = "right", ...props }, ref) => {
    const { open, onClose } = useSheet();
    const variant = sideVariants[side];

    React.useEffect(() => {
      if (!open) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      document.addEventListener("keydown", handler);
      return () => document.removeEventListener("keydown", handler);
    }, [open, onClose]);

    React.useEffect(() => {
      if (open) {
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = "";
      }
      return () => {
        document.body.style.overflow = "";
      };
    }, [open]);

    if (!open) return null;

    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-in fade-in-0"
          onClick={onClose}
          aria-hidden="true"
        />
        {/* Panel */}
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          className={cn(
            "fixed z-50 flex flex-col bg-background shadow-xl transition-transform duration-300 ease-in-out",
            variant.panel,
            open ? variant.enter : variant.exit,
            "animate-in",
            side === "left" ? "slide-in-from-left" : "slide-in-from-right",
            className
          )}
          {...props}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Close sheet"
          >
            <X className="h-4 w-4" />
          </button>
          {children}
        </div>
      </>
    );
  }
);
SheetContent.displayName = "SheetContent";

const SheetHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-2 p-6 pb-4", className)}
      {...props}
    />
  )
);
SheetHeader.displayName = "SheetHeader";

const SheetTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn("text-lg font-semibold text-foreground", className)}
      {...props}
    />
  )
);
SheetTitle.displayName = "SheetTitle";

const SheetDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
);
SheetDescription.displayName = "SheetDescription";

const SheetFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "mt-auto flex flex-col-reverse gap-2 p-6 pt-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
);
SheetFooter.displayName = "SheetFooter";

const SheetBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex-1 overflow-y-auto px-6 py-4", className)}
      {...props}
    />
  )
);
SheetBody.displayName = "SheetBody";

export interface SheetCloseProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

const SheetClose = React.forwardRef<HTMLButtonElement, SheetCloseProps>(
  ({ className, onClick, ...props }, ref) => {
    const { onClose } = useSheet();
    return (
      <button
        ref={ref}
        type="button"
        className={cn("", className)}
        onClick={(e) => {
          onClick?.(e);
          onClose();
        }}
        {...props}
      />
    );
  }
);
SheetClose.displayName = "SheetClose";

export {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetBody,
  SheetClose,
};
