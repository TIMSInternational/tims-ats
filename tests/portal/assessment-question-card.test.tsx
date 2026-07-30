import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import {
  AssessmentQuestionCard,
  type QuestionCardQuestion,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_components/assessment-question-card';

const singleChoiceQuestion: QuestionCardQuestion = {
  id: 'q1',
  order: 0,
  type: 'single_choice',
  prompt: 'Pick one',
  points: 1,
  options: [
    { id: 'a', label: 'Option A' },
    { id: 'b', label: 'Option B' },
  ],
};

function renderCard(props: React.ComponentProps<typeof AssessmentQuestionCard>) {
  // Set locale to EN for this test
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <AssessmentQuestionCard {...props} />
    </I18nProvider>,
  );
}

describe('AssessmentQuestionCard', () => {
  it('renders radio inputs for single_choice and reports exactly one selected id', () => {
    const onChange = vi.fn();
    renderCard({ question: singleChoiceQuestion, answer: undefined, onChange });
    fireEvent.click(screen.getByText('Option B'));
    expect(onChange).toHaveBeenCalledWith({ selectedOptionIds: ['b'] });
  });

  it('renders checkboxes for multi_choice and toggles ids in the array', () => {
    const onChange = vi.fn();
    const question: QuestionCardQuestion = { ...singleChoiceQuestion, type: 'multi_choice' };
    renderCard({ question, answer: { selectedOptionIds: ['a'] }, onChange });
    fireEvent.click(screen.getByText('Option B'));
    expect(onChange).toHaveBeenCalledWith({ selectedOptionIds: ['a', 'b'] });
  });

  it('renders a bounded textarea for free_text and reports freeText', () => {
    const onChange = vi.fn();
    const question: QuestionCardQuestion = {
      id: 'q2',
      order: 1,
      type: 'free_text',
      prompt: 'Explain your reasoning',
      points: 5,
      options: [],
    };
    renderCard({ question, answer: undefined, onChange });
    const textarea = screen.getByPlaceholderText(en.assessmentPlayer.questionCardFreeTextPlaceholder);
    fireEvent.change(textarea, { target: { value: 'my answer' } });
    expect(onChange).toHaveBeenCalledWith({ freeText: 'my answer' });
    expect(textarea).toHaveAttribute('maxlength', '20000');
  });

  it('never renders correctOptionIds even if accidentally present on the question object', () => {
    const onChange = vi.fn();
    const question = { ...singleChoiceQuestion, correctOptionIds: ['a'] } as QuestionCardQuestion;
    const { container } = renderCard({ question, answer: undefined, onChange });
    expect(container.innerHTML).not.toContain('correctOptionIds');
  });
});
