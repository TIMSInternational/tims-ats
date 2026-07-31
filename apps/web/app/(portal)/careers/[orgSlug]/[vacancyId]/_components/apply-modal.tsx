'use client';

import { useState } from 'react';
import { trpc } from '../../../../../../lib/trpc';
import { toast } from '../../../../../../lib/toast';
import { Modal } from '../../../../../../components';
import { TurnstileWidget } from '../../../../../../components/turnstile-widget';
import { useI18n } from '../../../../../../lib/i18n';
import { ApplyModalStep1 } from './apply-modal-step1';
import { ApplyModalStep2 } from './apply-modal-step2';
import { useCvUpload } from '../_lib/use-cv-upload';
import { EXPERIENCE_LEVELS } from '../_lib/experience-levels';

interface ApplyModalProps {
  vacancyId: string;
  vacancyTitle: string;
  companyName: string;
  onClose: () => void;
}

type Step = 1 | 2 | 3;

export function ApplyModal({ vacancyId, vacancyTitle, companyName, onClose }: ApplyModalProps) {
  const { t } = useI18n();
  const p = t.portal;
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
  const cv = useCvUpload(vacancyId);

  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const applyMutation = trpc.portal.applyToVacancy.useMutation();

  const isStep1Valid = firstName.trim() && lastName.trim() && email.trim() && email.includes('@');
  // When a captcha is configured, a solved token is required to submit.
  const captchaSatisfied = !turnstileSiteKey || !!captchaToken;

  const handleSubmit = async () => {
    if (!isStep1Valid) return;
    setSubmitting(true);
    try {
      const { cvFileKey, cvFileName } = await cv.uploadCvIfNeeded();
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
        cvFileKey,
        cvFileName,
        captchaToken: captchaToken ?? undefined,
        source: 'portal',
      });
      setSuccess(true);
    } catch (err) {
      if (err instanceof Error && err.message === 'cv_upload_failed') {
        toast(p.cvUploadFailed, { type: 'error' });
        setSubmitting(false);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Error al enviar la aplicacion';
      if (msg.includes('unique') || msg.includes('Unique') || msg.includes('already')) {
        toast(p.applyModalDuplicateError, { type: 'error' });
      } else {
        toast(msg, { type: 'error' });
      }
      setSubmitting(false);
    }
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
            Entendido
          </button>
        </div>
      </Modal>
    );
  }

  const stepLabels = ['Datos personales', 'Perfil y motivacion', 'Revisar y enviar'];

  return (
    <Modal title={`Aplicar a ${vacancyTitle}`} onClose={onClose} maxWidth="max-w-2xl">
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

      {/* Step 1: Personal Info */}
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

      {/* Step 2: Professional + Cover Letter */}
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

      {/* Step 3: Review & Submit */}
      {step === 3 && (
        <div className="space-y-5">
          <div className="rounded-lg bg-[#F6F6F6] p-4 space-y-2">
            <SummaryRow label={p.summaryName} value={`${firstName} ${lastName}`} />
            <SummaryRow label={p.summaryEmail} value={email} />
            {phone && <SummaryRow label={p.summaryPhone} value={phone} />}
            {location && <SummaryRow label={p.summaryLocation} value={location} />}
            {currentTitle && (
              <SummaryRow
                label={p.summaryCurrentTitle}
                value={`${currentTitle}${currentCompany ? ` en ${currentCompany}` : ''}`}
              />
            )}
            {yearsExperience && (
              <SummaryRow
                label={p.summaryExperience}
                value={EXPERIENCE_LEVELS.find((l) => l.value === yearsExperience)?.label ?? yearsExperience}
              />
            )}
            {linkedinUrl && <SummaryRow label="LinkedIn" value={linkedinUrl} />}
            <SummaryRow label={p.summaryVacancy} value={vacancyTitle} />
          </div>

          {coverLetter.trim() && (
            <div>
              <p className="mb-2 text-[12px] font-medium text-[#585858]">{p.yourMessage}</p>
              <div className="rounded-lg border border-[#EDEDED] bg-white p-3 text-[13px] leading-relaxed text-[#585858] whitespace-pre-wrap max-h-32 overflow-y-auto">
                {coverLetter}
              </div>
            </div>
          )}

          {turnstileSiteKey && (
            <div className="pt-1">
              <TurnstileWidget siteKey={turnstileSiteKey} onToken={setCaptchaToken} />
            </div>
          )}

          <p className="text-[11px] text-[#8B8B8B]">
            Al enviar tu aplicacion, aceptas que {companyName} procese tus datos personales con fines de seleccion de
            personal.
          </p>
        </div>
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
              Anterior
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
            Cancelar
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep((step + 1) as Step)}
              disabled={step === 1 && !isStep1Valid}
              className="flex h-9 items-center gap-1 rounded-lg bg-[#1F114C] px-5 text-sm font-medium text-white transition hover:bg-[#2a1a5c] disabled:opacity-50"
            >
              Siguiente
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!isStep1Valid || submitting || !captchaSatisfied}
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[12px] text-[#585858]">{label}:</span>
      <span className="max-w-[60%] truncate text-right text-[12px] font-medium text-[#333]">{value}</span>
    </div>
  );
}
