'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { AssessmentConsentNotice } from '../../../../../components/assessment-consent-notice';
import { ConsentStep } from '../../../../../components/consent-step';

// Step 2 of assigning a vacancy's tests: the notice the candidate will read, as one step of the consent guide (the same
// pattern the candidate gets): its title, one neutral line, "Leer el texto completo" and HR's UNCHECKED acknowledgment.
// The full text opens in place of the step, inside this same dialog, rather than as a second dialog on top of it
// (modality.md › Best practices: "Let people dismiss a modal view before presenting another one"; and for a subview,
// "provide a single path through the hierarchy"): the dialog's footer then offers only "Cerrar el texto completo".
export function AssignProviderNoticeStep({
  orgName,
  vacancyTitle,
  instrumentNames,
  acknowledged,
  onAcknowledge,
  reading,
  onRead,
  hintId,
}: {
  orgName: string;
  vacancyTitle: string;
  instrumentNames: string[];
  acknowledged: boolean;
  onAcknowledge: (value: boolean) => void;
  /** The full text is open in place of the step. */
  reading: boolean;
  onRead: () => void;
  /** The id of "Marca la casilla para asignar", shown while the box is unticked. */
  hintId: string;
}) {
  const { t } = useI18n();
  const ap = t.assignProviderAssessments;
  const readRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const wasReading = useRef(false);

  // Opening moves the keyboard (and a screen reader) to the text; closing brings it back to "Leer el texto completo".
  useEffect(() => {
    if (reading) textRef.current?.focus();
    else if (wasReading.current) readRef.current?.focus();
    wasReading.current = reading;
  }, [reading]);

  if (reading)
    return (
      <div ref={textRef} tabIndex={-1} className="rounded-lg">
        <AssessmentConsentNotice orgName={orgName} vacancyTitle={vacancyTitle} instruments={instrumentNames} />
      </div>
    );
  return (
    <div className="space-y-3">
      <ConsentStep
        title={t.assessmentConsentNotice.title}
        line={ap.noticeLine}
        checkboxLabel={ap.consentAck}
        checked={acknowledged}
        onChange={onAcknowledge}
        readFullLabel={ap.readFull}
        onReadFull={onRead}
        readFullRef={readRef}
        describedBy={acknowledged ? undefined : hintId}
      />
      {!acknowledged && (
        <p id={hintId} className="text-callout text-secondary">
          {ap.checkToAssign}
        </p>
      )}
    </div>
  );
}
