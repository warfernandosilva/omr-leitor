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
  return (
    <div className="card card-hover text-center">
      {icon ? (
        <div className="mx-auto mb-2 w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center text-brand-600 dark:text-brand-200">
          {icon}
        </div>
      ) : null}
      <p className={`text-2xl font-bold tracking-tight ${tones[tone]}`}>{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
      {hint ? <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{hint}</p> : null}
    </div>
  );
}
