'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { APPLICATION_CONSENT_TEXT_VERSION } from '@tims/shared';
import { trpc } from '../../../../../../lib/trpc';
import { toast } from '../../../../../../lib/toast';
import { Modal } from '../../../../../../components';
import { useI18n } from '../../../../../../lib/i18n';
import { ApplyModalStep1 } from './apply-modal-step1';
import { ApplyModalStep2 } from './apply-modal-step2';
import { ApplyModalReview } from './apply-modal-review';
import { ApplySuccess } from './apply-success';
import { ApplyStepIndicator } from './apply-step-indicator';
import { ApplyModalFooter } from './apply-modal-footer';
import { DiscardChangesPrompt } from '../../../../../../components/discard-changes-prompt';
import { useCvUpload } from '../_lib/use-cv-upload';
import {
  applyErrorField,
  applyErrorMessage,
  applyErrorStep,
  isVacancyClosedError,
  type ApplyErrorField,
} from '../_lib/apply-error-message';
import { isValidApplyEmail, isValidLinkedinUrl, normalizeLinkedinUrl } from '../_lib/apply-fields';
import { trackCareersFunnel } from '../../../../../../lib/analytics/web-analytics';

interface ApplyModalProps {
  vacancyId: string;
  vacancyTitle: string;
  companyName: string;
  // The data controller named in the consent text: the ORGANIZATION (tenant) that owns the
  // vacancy and receives the DataConsent row — never the vacancy's client company, which
  // may differ. Must match the org the linked /careers/[orgSlug]/privacy notice names.
  controllerName: string;
  onClose: () => void;
}

type Step = 1 | 2 | 3;

export function ApplyModal({ vacancyId, vacancyTitle, companyName, controllerName, onClose }: ApplyModalProps) {
  const { t, locale } = useI18n();
  const p = t.portal;
  const params = useParams<{ orgSlug: string }>();
  // Platform-default candidate privacy notice for this org. A per-organization policy URL
  // setting does not exist yet (follow-up); this route names the org as controller.
  const privacyHref = `/careers/${encodeURIComponent(params?.orgSlug ?? '')}/privacy`;
  // The candidate portal: the dashboard sends a signed-out candidate to the portal login.
  const portalHref = `/careers/${encodeURIComponent(params?.orgSlug ?? '')}/dashboard`;
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');

  const [currentTitle, setCurrentTitle] = useState('');
  const [currentCompany, setCurrentCompany] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [coverLetter, setCoverLetter] = useState('');
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  // Explicit consent: never pre-checked, required to submit.
  const [consentAccepted, setConsentAccepted] = useState(false);
  // A field the server rejected: its step shows the field error until the value changes.
  const [rejectedField, setRejectedField] = useState<ApplyErrorField | null>(null);
  const cv = useCvUpload(vacancyId);

  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const applyMutation = trpc.portal.applyToVacancy.useMutation();
  const utils = trpc.useUtils();

  const isStep1Valid = Boolean(firstName.trim() && lastName.trim() && isValidApplyEmail(email));
  const isStep2Valid = isValidLinkedinUrl(linkedinUrl);
  // When a captcha is configured, a solved token is required to submit.
  const captchaSatisfied = !turnstileSiteKey || !!captchaToken;
  const cvUploadFailed = cv.error === 'upload_failed';

  // Something typed is lost when the modal unmounts (there is no draft), so closing a filled form
  // asks first (the Modal's in-dialog "¿Descartar los cambios?") — and nothing closes it while the
  // application is being sent.
  const hasInput = [firstName, lastName, email, phone, location, currentTitle, currentCompany, yearsExperience, linkedinUrl, coverLetter]
    .some((value) => value.trim().length > 0) || cv.file !== null || consentAccepted;
  // A STABLE callback: Modal re-runs its focus effect whenever onClose changes identity, so a fresh
  // function per keystroke would pull focus out of the field being typed in. The guard reads the
  // latest state from a ref instead.
  const closeState = useRef({ submitting, onClose });
  useEffect(() => {
    closeState.current = { submitting, onClose };
  });
  const requestClose = useCallback(() => {
    if (closeState.current.submitting) return;
    closeState.current.onClose();
  }, []);
  // "Cancelar" is a close request too: with typed data it asks first, with the same in-dialog prompt.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const cancel = () => (hasInput ? setConfirmingCancel(true) : requestClose());

  // The vacancy stopped taking applications while the form was open: say so, and refetch the page so
  // it shows the closed state.
  const handleVacancyClosed = () => {
    toast(p.applyVacancyClosed, { type: 'error' });
    setSubmitting(false);
    void utils.portal.getVacancy.invalidate({ id: vacancyId });
  };

  const submit = async ({ skipCv }: { skipCv: boolean }) => {
    if (!isStep1Valid || !isStep2Valid || !consentAccepted) return;
    setSubmitting(true);
    let cvFields: { cvFileKey?: string; cvFileName?: string } = {};
    if (!skipCv) {
      try {
        cvFields = await cv.uploadCvIfNeeded();
      } catch (err) {
        if (err instanceof Error && err.message === 'vacancy_closed') {
          handleVacancyClosed();
          return;
        }
        // The hook set error='upload_failed'; the review step now shows an inline
        // alert with "retry" and "remove CV and continue". Nothing was submitted.
        setSubmitting(false);
        return;
      }
    }
    try {
      await applyMutation.mutateAsync({
        vacancyId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        location: location.trim() || undefined,
        currentTitle: currentTitle.trim() || undefined,
        currentCompany: currentCompany.trim() || undefined,
        yearsExperience: yearsExperience ? parseInt(yearsExperience) : undefined,
        linkedinUrl: normalizeLinkedinUrl(linkedinUrl) || undefined,
        coverLetter: coverLetter.trim() || undefined,
        ...cvFields,
        captchaToken: captchaToken ?? undefined,
        source: 'portal',
        consentAccepted: true,
        consentTextVersion: APPLICATION_CONSENT_TEXT_VERSION,
        // The server hashes its canonical copy of the text shown in this locale (#313).
        consentLocale: locale === 'EN' ? 'en' : 'es',
      });
      setSuccess(true);
      trackCareersFunnel('application_submitted', params?.orgSlug ?? '');
      // The detail page shows "N personas aplicaron"; refetch it so the count includes this application.
      void utils.portal.getVacancy.invalidate({ id: vacancyId });
    } catch (err) {
      // Duplicates are acknowledged server-side like any new application, so there is no
      // "already applied" error to map.
      if (isVacancyClosedError(err)) {
        handleVacancyClosed();
        return;
      }
      // Every failed submit toasts (frontend.md: onError toast on every mutation; error toasts stay until
      // dismissed). A field the candidate can fix also takes them back to the step that holds it, where the
      // field itself shows the error.
      toast(applyErrorMessage(err, p), { type: 'error' });
      const field = applyErrorField(err);
      if (field) {
        setRejectedField(field);
        setStep(applyErrorStep(field));
      }
      setSubmitting(false);
    }
  };

  const removeCvAndContinue = () => {
    cv.removeFile();
    void submit({ skipCv: true });
  };

  if (success) {
    return <ApplySuccess vacancyTitle={vacancyTitle} companyName={companyName} portalHref={portalHref} onClose={onClose} />;
  }

  return (
    <Modal
      // A short title that never truncates on a phone; the vacancy (often long) wraps in full beneath it.
      title={p.applyDialogTitle}
      description={vacancyTitle}
      onClose={requestClose}
      size="lg"
      fullScreenOnMobile
      dirty={hasInput && !submitting}
      discardTitle={p.applyDiscardTitle}
      discardBody={p.applyDiscardBody}
      footer={
        confirmingCancel ? undefined : (
        <ApplyModalFooter
          step={step}
          submitting={submitting}
          canContinue={
            step === 1
              ? isStep1Valid
              : step === 2
                ? isStep2Valid
                : isStep1Valid && isStep2Valid && !submitting && captchaSatisfied && consentAccepted && !cvUploadFailed
          }
          onBack={() => setStep((step - 1) as Step)}
          onCancel={cancel}
          onNext={() => setStep((step + 1) as Step)}
          onSubmit={() => void submit({ skipCv: false })}
        />
        )
      }
    >
      <ApplyStepIndicator step={step} labels={[p.stepPersonal, p.stepProfile, p.stepReview]} />

      {step === 1 && (
        <ApplyModalStep1
          showRequiredHint={!isStep1Valid}
          firstName={firstName}
          setFirstName={setFirstName}
          lastName={lastName}
          setLastName={setLastName}
          email={email}
          setEmail={(value) => {
            setEmail(value);
            if (rejectedField === 'email') setRejectedField(null);
          }}
          phone={phone}
          setPhone={setPhone}
          location={location}
          setLocation={setLocation}
          emailRejected={rejectedField === 'email'}
        />
      )}

      {step === 2 && (
        <ApplyModalStep2
          currentTitle={currentTitle}
          setCurrentTitle={setCurrentTitle}
          currentCompany={currentCompany}
          setCurrentCompany={setCurrentCompany}
          yearsExperience={yearsExperience}
          setYearsExperience={setYearsExperience}
          linkedinUrl={linkedinUrl}
          setLinkedinUrl={(value) => {
            setLinkedinUrl(value);
            if (rejectedField === 'linkedinUrl') setRejectedField(null);
          }}
          coverLetter={coverLetter}
          setCoverLetter={setCoverLetter}
          cvFile={cv.file}
          cvError={cv.error}
          cvUploading={cv.uploading}
          onCvFileChange={cv.handleFileChange}
          onCvRemove={cv.removeFile}
          profileLinkRejected={rejectedField === 'linkedinUrl'}
        />
      )}

      {step === 3 && (
        <ApplyModalReview
          summary={{
            firstName,
            lastName,
            email,
            phone,
            location,
            currentTitle,
            currentCompany,
            yearsExperience,
            linkedinUrl,
            coverLetter,
          }}
          vacancyTitle={vacancyTitle}
          controllerName={controllerName}
          privacyHref={privacyHref}
          cvFile={cv.file}
          cvUploadFailed={cvUploadFailed}
          submitting={submitting}
          consentAccepted={consentAccepted}
          onConsentChange={setConsentAccepted}
          onRetryCv={() => void submit({ skipCv: false })}
          onRemoveCvAndContinue={removeCvAndContinue}
          turnstileSiteKey={turnstileSiteKey}
          onCaptchaToken={setCaptchaToken}
        />
      )}

      {confirmingCancel && (
        <DiscardChangesPrompt
          onKeepEditing={() => setConfirmingCancel(false)}
          onDiscard={requestClose}
          title={p.applyDiscardTitle}
          body={p.applyDiscardBody}
        />
      )}
    </Modal>
  );
}
