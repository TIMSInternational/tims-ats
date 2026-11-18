'use client';

import { useEffect, useRef } from 'react';
import { AUTH_TITLE_CLASSES } from './auth-card';

// The view that replaces a submitted form (link sent, account created, password updated). It is a status
// region and takes focus on its h1, so the change is announced instead of focus falling to <body>
// (feedback.md › Best practices: "Make sure all feedback is accessible").
export function AuthSuccess({
  title,
  icon = 'check',
  children,
}: {
  title: string;
  icon?: 'check' | 'mail';
  children?: React.ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <div role="status" className="text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-success-bg">
        <svg
          className="size-6 text-success"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          {icon === 'mail' ? (
            <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          ) : (
            <path d="M5 13l4 4L19 7" />
          )}
        </svg>
      </div>
      <h1 ref={heading} tabIndex={-1} className={`${AUTH_TITLE_CLASSES} mb-2 outline-none`}>
        {title}
      </h1>
      {children}
    </div>
  );
}
