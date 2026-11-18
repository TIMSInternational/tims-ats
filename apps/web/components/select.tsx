'use client';

import React, { forwardRef } from 'react';
import { selectClasses, type FieldSize } from './field-styles';

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: FieldSize;
}

/** A native <select> with the shared field styling (6–15 options; fewer → radios). Wrap it in <Field>. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', className = '', children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={selectClasses(size, className)} {...rest}>
      {children}
    </select>
  );
});
