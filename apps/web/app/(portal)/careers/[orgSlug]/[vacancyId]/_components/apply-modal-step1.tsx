'use client';

import { useState } from 'react';
import { Field } from '../../../../../../components/field';
import { TextInput } from '../../../../../../components/text-input';
import { useI18n } from '../../../../../../lib/i18n';
import { isValidApplyEmail } from '../_lib/apply-fields';

interface ApplyModalStep1Props {
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  /** The server rejected the email: show the field error even before the field is touched again. */
  emailRejected?: boolean;
  /** "Siguiente" is disabled: say which fields it waits for. */
  showRequiredHint?: boolean;
}

export function ApplyModalStep1({
  firstName,
  setFirstName,
  lastName,
  setLastName,
  email,
  setEmail,
  phone,
  setPhone,
  location,
  setLocation,
  emailRejected = false,
  showRequiredHint = false,
}: ApplyModalStep1Props) {
  const { t } = useI18n();
  const p = t.portal;
  const [emailTouched, setEmailTouched] = useState(false);
  const showEmailError = emailRejected || (emailTouched && email.trim().length > 0 && !isValidApplyEmail(email));
  // Three of the five fields are required, so the two optional ones are the ones marked.
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={p.firstNameLabel}>
          {(c) => (
            <TextInput
              {...c}
              required
              aria-required="true"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              maxLength={100}
              placeholder={p.firstNamePlaceholder}
              autoFocus
            />
          )}
        </Field>
        <Field label={p.lastNameLabel}>
          {(c) => (
            <TextInput
              {...c}
              required
              aria-required="true"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              maxLength={100}
              placeholder={p.lastNamePlaceholder}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={p.emailLabel} error={showEmailError ? p.emailInvalid : undefined}>
          {(c) => (
            <TextInput
              {...c}
              required
              aria-required="true"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              maxLength={254}
              placeholder="maria.lopez@gmail.com"
            />
          )}
        </Field>
        <Field label={p.phoneLabel} optional>
          <TextInput
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={30}
            placeholder={p.phonePlaceholder}
          />
        </Field>
      </div>
      <Field label={p.locationLabel} optional>
        <TextInput
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={200}
          placeholder={p.cityCountryPlaceholder}
        />
      </Field>
      {showRequiredHint && <p className="text-callout text-secondary">{p.step1RequiredHint}</p>}
    </div>
  );
}
