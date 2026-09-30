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
import { useCvUpload } from '../_lib/use-cv-upload';
import { applyErrorMessage } from '../_lib/apply-error-message';

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
  const { t } = useI18n();
  const p = t.portal;
  const params = useParams<{ orgSlug: string }>();
  // Platform-default candidate privacy notice for this org. A per-organization policy URL
  // setting does not exist yet (follow-up); this route names the org as controller.
  const privacyHref = `/careers/${encodeURIComponent(params?.orgSlug ?? '')}/privacy`;
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
  const cv = useCvUpload(vacancyId);

  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const applyMutation = trpc.portal.applyToVacancy.useMutation();
  const utils = trpc.useUtils();

  const isStep1Valid = firstName.trim() && lastName.trim() && email.trim() && email.includes('@');
  // When a captcha is configured, a solved token is required to submit.
  const captchaSatisfied = !turnstileSiteKey || !!captchaToken;
  const cvUploadFailed = cv.error === 'upload_failed';

  const submit = async ({ skipCv }: { skipCv: boolean }) => {
    if (!isStep1Valid || !consentAccepted) return;
    setSubmitting(true);
    let cvFields: { cvFileKey?: string; cvFileName?: string } = {};
    if (!skipCv) {
      try {
        cvFields = await cv.uploadCvIfNeeded();
      } catch {
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
        linkedinUrl: linkedinUrl.trim() || undefined,
        coverLetter: coverLetter.trim() || undefined,
        ...cvFields,
        captchaToken: captchaToken ?? undefined,
        source: 'portal',
        consentAccepted: true,
        consentTextVersion: APPLICATION_CONSENT_TEXT_VERSION,
      });
      setSuccess(true);
      // The detail page shows "N personas aplicaron"; refetch it so the count includes this application.
      void utils.portal.getVacancy.invalidate({ id: vacancyId });
    } catch (err) {
      // Duplicates are acknowledged server-side like any new application, so there is no
      // "already applied" error to map.
      toast(applyErrorMessage(err, p), { type: 'error' });
      setSubmitting(false);
    }
  };

  const removeCvAndContinue = () => {
    cv.removeFile();
    void submit({ skipCv: true });
  };

  if (success) {
    return (
      <Modal title="" onClose={onClose} maxWidth="max-w-lg">
        <div className="flex flex-col items-center py-6 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
            <svg
              className="h-8 w-8 text-green-500"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="mb-2 text-[18px] font-bold text-[#1F114C]">{p.applicationSentTitle}</h3>
          <p className="mb-1 text-[14px] text-[#585858]">
            {p.applicationReceivedPrefix} <span className="font-medium text-[#333]">{vacancyTitle}</span>{' '}
            {p.applicationReceivedSuffix}
          </p>
          <p className="mb-6 text-[13px] text-[#8B8B8B]">
            {p.teamWillReviewPrefix} {companyName} {p.teamWillReviewSuffix}
          </p>
          <button
            onClick={onClose}
            className="h-10 rounded-lg bg-[#1F114C] px-6 text-[13px] font-medium text-white transition-colors hover:bg-[#2a1a5c]"
          >
            {p.understood}
          </button>
        </div>
      </Modal>
    );
  }

  const stepLabels = [p.stepPersonal, p.stepProfile, p.stepReview];

  return (
    <Modal title={`${p.applyTitlePrefix} ${vacancyTitle}`} onClose={onClose} maxWidth="max-w-2xl">
      {/* Step indicator */}
      <div className="mb-6 flex items-center gap-2">
        {stepLabels.map((label, i) => (
          <div key={i} className="flex flex-1 items-center gap-2">
            <div
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                step > i + 1
                  ? 'bg-green-500 text-white'
                  : step === i + 1
                    ? 'bg-[#DD0C15] text-white'
                    : 'bg-[#EDEDED] text-[#8B8B8B]'
              }`}
            >
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span className={`text-[11px] ${step === i + 1 ? 'font-medium text-[#1F114C]' : 'text-[#8B8B8B]'}`}>
              {label}
            </span>
            {i < 2 && <div className={`h-[1px] flex-1 ${step > i + 1 ? 'bg-green-500' : 'bg-[#EDEDED]'}`} />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <ApplyModalStep1
          firstName={firstName}
          setFirstName={setFirstName}
          lastName={lastName}
          setLastName={setLastName}
          email={email}
          setEmail={setEmail}
          phone={phone}
          setPhone={setPhone}
          location={location}
          setLocation={setLocation}
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
          setLinkedinUrl={setLinkedinUrl}
          coverLetter={coverLetter}
          setCoverLetter={setCoverLetter}
          cvFile={cv.file}
          cvError={cv.error}
          cvUploading={cv.uploading}
          onCvFileChange={cv.handleFileChange}
          onCvRemove={cv.removeFile}
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
            <span className="flex items-center gap-1.5 text-[11px] text-[#8B8B8B]">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#DD0C15]/30 border-t-[#DD0C15]" />
              {p.submittingApplication}
            </span>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={submitting}
            className="h-9 rounded-lg border border-[#EDEDED] px-4 text-sm text-[#585858] transition hover:bg-[#F6F6F6] disabled:opacity-50"
          >
            {p.cancel}
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep((step + 1) as Step)}
              disabled={step === 1 && !isStep1Valid}
              className="flex h-9 items-center gap-1 rounded-lg bg-[#1F114C] px-5 text-sm font-medium text-white transition hover:bg-[#2a1a5c] disabled:opacity-50"
            >
              {p.nextStep}
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          ) : (
            <button
              onClick={() => void submit({ skipCv: false })}
              disabled={!isStep1Valid || submitting || !captchaSatisfied || !consentAccepted || cvUploadFailed}
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
