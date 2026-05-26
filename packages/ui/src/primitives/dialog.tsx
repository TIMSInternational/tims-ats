"use client";

import * as React from "react";
import { cn } from "../lib/utils";
import { X } from "lucide-react";

interface DialogContextValue {
  open: boolean;
  onClose: () => void;
}

const DialogContext = React.createContext<DialogContextValue>({
  open: false,
  onClose: () => {},
});

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function Dialog({ open = false, onOpenChange, children }: DialogProps) {
  const onClose = React.useCallback(() => {
    onOpenChange?.(false);
  }, [onOpenChange]);

  return (
    <DialogContext.Provider value={{ open, onClose }}>
      {children}
    </DialogContext.Provider>
  );
}

function useDialog() {
  return React.useContext(DialogContext);
}

export interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  onClose?: () => void;
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, onClose: onCloseProp, ...props }, ref) => {
    const { open, onClose } = useDialog();
    const handleClose = onCloseProp ?? onClose;

    const dialogRef = React.useRef<HTMLDialogElement | null>(null);

    React.useEffect(() => {
      const el = dialogRef.current;
      if (!el) return;
      if (open) {
        if (!el.open) el.showModal();
      } else {
        if (el.open) el.close();
      }
    }, [open]);

    React.useEffect(() => {
      const el = dialogRef.current;
      if (!el) return;
      const handler = () => handleClose();
      el.addEventListener("cancel", handler);
      return () => el.removeEventListener("cancel", handler);
    }, [handleClose]);

    const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === e.currentTarget) handleClose();
    };

    if (!open) return null;

    return (
      <dialog
        ref={dialogRef}
        className={cn(
          "fixed inset-0 z-50 m-auto max-h-[calc(100vh-4rem)] w-full max-w-lg overflow-auto rounded-xl border border-border bg-background p-0 shadow-lg",
          "backdrop:bg-black/50 backdrop:backdrop-blur-sm",
          "open:animate-in open:fade-in-0 open:zoom-in-95",
          "not-open:animate-out not-open:fade-out-0 not-open:zoom-out-95"
        )}
        onClick={handleBackdropClick}
      >
        <div
          ref={ref}
          className={cn("relative flex flex-col gap-4 p-6", className)}
          {...props}
        >
          <button
            type="button"
            onClick={handleClose}
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
          {children}
        </div>
      </dialog>
    );
  }
);
DialogContent.displayName = "DialogContent";

const DialogHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
      {...props}
    />
  )
);
DialogHeader.displayName = "DialogHeader";

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2
      ref={ref}
      className={cn("text-lg font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  )
);
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
);
DialogDescription.displayName = "DialogDescription";

const DialogFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
        className
      )}
      {...props}
    />
  )
);
DialogFooter.displayName = "DialogFooter";

export interface DialogCloseProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

const DialogClose = React.forwardRef<HTMLButtonElement, DialogCloseProps>(
  ({ className, onClick, ...props }, ref) => {
    const { onClose } = useDialog();
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
DialogClose.displayName = "DialogClose";

export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
};
