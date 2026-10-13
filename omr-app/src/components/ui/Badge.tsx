import type { ReactNode } from 'react';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface Props {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const tones: Record<Tone, string> = {
  success: 'badge-success',
  warning: 'badge-warning',
  danger: 'badge-danger',
  info: 'badge-info',
  neutral: 'badge-neutral',
};

/** Selo de estado. Verde = sucesso/concluído, laranja = alerta/revisão, vermelho = erro. */
export default function Badge({ tone = 'neutral', icon, children, className = '' }: Props) {
  return (
    <span className={`${tones[tone]} ${className}`}>
      {icon ? <span className="inline-flex" aria-hidden>{icon}</span> : null}
      {children}
    </span>
  );
}
