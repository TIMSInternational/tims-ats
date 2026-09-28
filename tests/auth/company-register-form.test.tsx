import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

const mocks = vi.hoisted(() => ({ signUp: vi.fn() }));
vi.mock('@tims/auth/client', () => ({ createSupabaseBrowserClient: () => ({ auth: { signUp: mocks.signUp } }) }));
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en }) }));

import { RegisterForm } from '../../apps/web/app/(auth)/register/register-form';

describe('company registration password policy', () => {
  it('rejects an eleven-character password before calling Supabase', () => {
    mocks.signUp.mockReset();
    render(<RegisterForm accountType="company" onBack={() => undefined} />);
    const fields = screen.getAllByRole('textbox');
    fireEvent.change(fields[0], { target: { value: 'Test' } });
    fireEvent.change(fields[1], { target: { value: 'User' } });
    fireEvent.change(fields[2], { target: { value: 'Test Company' } });
    fireEvent.change(fields[3], { target: { value: 'test@example.test' } });
    const password = screen.getByPlaceholderText(en.auth.passwordMinPlaceholder);
    fireEvent.change(password, { target: { value: 'shortsecret' } });
    fireEvent.submit(password.closest('form')!);
    expect(screen.getByText(en.auth.passwordMinLength)).toBeInTheDocument();
    expect(mocks.signUp).not.toHaveBeenCalled();
    expect(password).toHaveAttribute('minlength', '12');
    expect(password).toHaveAttribute('maxlength', '128');
  });
});
