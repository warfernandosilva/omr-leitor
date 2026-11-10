import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: string | number;
  tone?: 'default' | 'info' | 'success' | 'danger' | 'warning';
  /** Ícone Lucide exibido acima do valor. */
  icon?: ReactNode;
  /** Texto auxiliar (descrição ou comparação com período anterior). */
  hint?: string;
}

const tones: Record<NonNullable<Props['tone']>, string> = {
  default: 'text-ink dark:text-white',
  info: 'text-brand-600 dark:text-brand-200',
  success: 'text-success-600 dark:text-success-100',
  danger: 'text-danger-600 dark:text-danger-100',
  warning: 'text-warning-600 dark:text-warning-100',
};

/** Cartão de indicador: ícone, valor principal, rótulo e texto auxiliar. */
export default function StatCard({ label, value, tone = 'default', icon, hint }: Props) {
  const accent: Record<NonNullable<Props['tone']>, string> = {
    default: 'bg-brand-500',
    info: 'bg-secondary-500',
    success: 'bg-success-500',
    danger: 'bg-danger-500',
    warning: 'bg-warning-500',
  };
  return (
    <div className="stat-card">
      <span className={`absolute inset-x-0 top-0 h-1 ${accent[tone]}`} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-2xl font-bold tracking-tight ${tones[tone]}`}>{value}</p>
          <p className="text-xs text-[#71809A] dark:text-gray-400 mt-1">{label}</p>
          {hint ? <p className="text-[11px] text-[#71809A] dark:text-gray-400 mt-1">{hint}</p> : null}
        </div>
        {icon ? (
          <div className="w-10 h-10 rounded-[10px] bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center text-brand-600 dark:text-brand-200 shrink-0" aria-hidden>
            {icon}
          </div>
        ) : null}
      </div>
    </div>
  );
}
