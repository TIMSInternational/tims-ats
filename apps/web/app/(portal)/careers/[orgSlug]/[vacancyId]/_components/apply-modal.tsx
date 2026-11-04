'use client';

import { useState } from 'react';
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
import { useCvUpload } from '../_lib/use-cv-upload';
import {
  applyErrorField,
  applyErrorMessage,
  applyErrorStep,
  isVacancyClosedError,
  type ApplyErrorField,
} from '../_lib/apply-error-message';
import { isValidApplyEmail, isValidLinkedinUrl, normalizeLinkedinUrl } from '../_lib/apply-fields';

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
  // asks first — and nothing closes it while the application is being sent.
  const hasInput = [firstName, lastName, email, phone, location, currentTitle, currentCompany, yearsExperience, linkedinUrl, coverLetter]
    .some((value) => value.trim().length > 0) || cv.file !== null || consentAccepted;
  const requestClose = () => {
    if (submitting) return;
    if (!success && hasInput && !window.confirm(p.discardConfirm)) return;
    onClose();
  };

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
      // The detail page shows "N personas aplicaron"; refetch it so the count includes this application.
      void utils.portal.getVacancy.invalidate({ id: vacancyId });
    } catch (err) {
      // Duplicates are acknowledged server-side like any new application, so there is no
      // "already applied" error to map.
      if (isVacancyClosedError(err)) {
        handleVacancyClosed();
        return;
      }
      toast(applyErrorMessage(err, p), { type: 'error' });
      // A field the candidate can fix: take them back to the step that holds it.
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
    <Modal title={`${p.applyTitlePrefix} ${vacancyTitle}`} onClose={requestClose} maxWidth="max-w-2xl">
      <ApplyStepIndicator step={step} labels={[p.stepPersonal, p.stepProfile, p.stepReview]} />

      {step === 1 && (
        <ApplyModalStep1
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

      {/* Navigation */}
      <div className="mt-6 flex items-center justify-between border-t border-[#EDEDED] pt-4">
        <div>
          {step > 1 && !submitting && (
            <button
              onClick={() => setStep((step - 1) as Step)}
              className="flex items-center gap-1 text-[12px] text-[#585858] transition hover:text-[#1F114C]"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              {p.previousStep}
            </button>
          )}
          {submitting && (
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#DD0C15]/30 border-t-[#DD0C15]" />
              {p.submittingApplication}
            </span>
          )}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={requestClose}
            disabled={submitting}
            className="h-9 rounded-lg border border-[#EDEDED] px-4 text-sm text-[#585858] transition hover:bg-[#F6F6F6] disabled:opacity-50"
          >
            {p.cancel}
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep((step + 1) as Step)}
              disabled={(step === 1 && !isStep1Valid) || (step === 2 && !isStep2Valid)}
              className="flex h-9 items-center gap-1 rounded-lg bg-[#1F114C] px-5 text-sm font-medium text-white transition hover:bg-[#2a1a5c] disabled:opacity-50"
            >
              {p.nextStep}
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit({ skipCv: false })}
              disabled={!isStep1Valid || !isStep2Valid || submitting || !captchaSatisfied || !consentAccepted || cvUploadFailed}
              className="flex h-9 items-center gap-2 rounded-lg bg-[#DD0C15] px-5 text-sm font-medium text-white transition hover:bg-[#c00b13] disabled:opacity-50"
            >
              {submitting ? p.sendingShort : p.submitApplication}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
