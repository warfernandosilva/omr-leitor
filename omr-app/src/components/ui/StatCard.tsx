interface Props {
  label: string;
  value: string | number;
  tone?: 'default' | 'info' | 'success' | 'danger' | 'warning';
}

const tones: Record<NonNullable<Props['tone']>, string> = {
  default: 'text-gray-900 dark:text-white',
  info: 'text-blue-600 dark:text-blue-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  danger: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
};

export default function StatCard({ label, value, tone = 'default' }: Props) {
  return (
    <div className="card card-hover text-center">
      <p className={`text-2xl font-bold tracking-tight ${tones[tone]}`}>{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
    </div>
  );
}
