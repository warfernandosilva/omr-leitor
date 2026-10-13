import type { ReactNode } from 'react';

interface Props {
  label: string;
  htmlFor?: string;
  required?: boolean;
  helper?: ReactNode;
  /** Texto de erro (exibido abaixo do campo; anula o helper). */
  error?: string | null;
  children: ReactNode;
  className?: string;
}

/** Bloco de formulário: rótulo ACIMA, campo, ajuda/erro ABAIXO. */
export default function Field({ label, htmlFor, required, helper, error, children, className = '' }: Props) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="label">
        {label}
        {required ? <span className="text-danger-500 ml-0.5" aria-hidden>*</span> : null}
      </label>
      {children}
      {error ? (
        <p id={errorId} role="alert" className="field-error">{error}</p>
      ) : helper ? (
        <p className="field-helper">{helper}</p>
      ) : null}
    </div>
  );
}
