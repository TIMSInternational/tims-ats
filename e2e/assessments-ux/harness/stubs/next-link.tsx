import React from 'react';
export default function Link({ href, children, ...rest }: { href: string; children?: React.ReactNode }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
