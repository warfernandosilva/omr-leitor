import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  /** Marca o campo como inválido (borda vermelha + aria-invalid). */
  invalid?: boolean;
}

const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { invalid = false, className = '', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`input ${invalid ? 'input-error' : ''} ${className}`}
      {...rest}
    />
  );
});

export default Input;
