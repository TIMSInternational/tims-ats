'use client';

import { useState } from 'react';
import { Button, Field, TextInput } from '../../../../components';

interface EmailActionFormProps {
  label: string;
  help: string;
  placeholder: string;
  submitLabel: string;
  destructive?: boolean;
  isPending: boolean;
  /** Called with a trimmed address that contains "@"; call `done` on success to clear the field. */
  onSubmit: (email: string, done: () => void) => void;
}

/** One support action that targets a user by email (reset password, close sessions). */
export function EmailActionForm({
  label,
  help,
  placeholder,
  submitLabel,
  destructive = false,
  isPending,
  onSubmit,
}: EmailActionFormProps) {
  const [email, setEmail] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const em = email.trim();
        if (em && em.includes('@')) onSubmit(em, () => setEmail(''));
      }}
      className="rounded-lg border border-border p-4"
    >
      <Field label={label} help={help}>
        {(control) => (
          <div className="flex flex-col gap-2 sm:flex-row">
            <TextInput
              {...control}
              type="email"
              autoComplete="off"
              placeholder={placeholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-w-0 sm:flex-1"
            />
            <Button
              type="submit"
              variant={destructive ? 'destructive-secondary' : 'secondary'}
              disabled={!email.trim()}
              loading={isPending}
              className="shrink-0"
            >
              {submitLabel}
            </Button>
          </div>
        )}
      </Field>
    </form>
  );
}
