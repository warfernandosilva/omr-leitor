interface Props {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-base',
};

const palette = [
  'bg-brand-500',
  'bg-success-500',
  'bg-warning-500',
  'bg-danger-500',
  'bg-navy-800',
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/** Avatar com iniciais e cor determinística a partir do nome. */
export default function Avatar({ name, size = 'md', className = '' }: Props) {
  return (
    <span
      aria-hidden
      className={`${sizes[size]} ${colorFor(name)} rounded-full inline-flex items-center justify-center font-semibold text-white shrink-0 ${className}`}
    >
      {initials(name)}
    </span>
  );
}
