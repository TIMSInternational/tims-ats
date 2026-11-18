'use client';

import React, { forwardRef } from 'react';
import { inputClasses, type FieldSize } from './field-styles';

export interface TextInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** md = 36px (44px on touch), lg = 44px everywhere (auth and portal forms). */
  size?: FieldSize;
}

/** A text input with the shared field styling. Wrap it in <Field> for the label, help and error. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { size = 'md', className = '', type = 'text', ...rest },
  ref,
) {
  return <input ref={ref} type={type} className={inputClasses(size, className)} {...rest} />;
});
