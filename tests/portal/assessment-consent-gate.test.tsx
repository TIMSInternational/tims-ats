import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { AssessmentConsentGate } from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-consent-gate';

function renderGate(props: Partial<React.ComponentProps<typeof AssessmentConsentGate>> = {}) {
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <AssessmentConsentGate onStart={vi.fn()} isSubmitting={false} errorMessage={null} {...props} />
    </I18nProvider>,
  );
}

describe('AssessmentConsentGate', () => {
  it('disables the start button until the checkbox is checked', () => {
    renderGate();
    const button = screen.getByRole('button', { name: en.assessmentPlayer.consentStartButton });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(button).toBeEnabled();
  });

  it('calls onStart when the checked button is clicked', () => {
    const onStart = vi.fn();
    renderGate({ onStart });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: en.assessmentPlayer.consentStartButton }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('shows the submitting label and disables the button while isSubmitting', () => {
    renderGate({ isSubmitting: true });
    expect(screen.getByRole('button', { name: en.assessmentPlayer.consentStarting })).toBeDisabled();
  });

  it('renders a translated error message when provided', () => {
    renderGate({ errorMessage: en.assessmentPlayer.errorConsentRequired });
    expect(screen.getByText(en.assessmentPlayer.errorConsentRequired)).toBeInTheDocument();
  });
});
