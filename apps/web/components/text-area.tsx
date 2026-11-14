'use client';

import React, { forwardRef } from 'react';
import { textareaClasses } from './field-styles';

/** A multi-line input with the shared field styling. Wrap it in <Field>. */
export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className = '', ...rest }, ref) {
    return <textarea ref={ref} className={textareaClasses(className)} {...rest} />;
  },
);
