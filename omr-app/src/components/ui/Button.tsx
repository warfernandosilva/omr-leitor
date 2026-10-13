import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'icon';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Exibe spinner e desabilita o botão. */
  loading?: boolean;
  /** Ícone Lucide à esquerda do rótulo (ex.: <Plus size={16} strokeWidth={2} />). */
  icon?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  success: 'btn-success',
  danger: 'btn-danger',
};

const sizes: Record<Exclude<Size, 'icon'>, string> = {
  sm: 'btn-sm',
  md: '',
  lg: 'px-5 py-3 text-base',
};

/** Botão padronizado Gabarito+. Para botão só-ícone use size="icon". */
export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  disabled,
  className = '',
  children,
  ...rest
}: Props) {
  if (size === 'icon') {
    return (
      <button
        className={`btn-icon ${className}`}
        disabled={disabled || loading}
        {...rest}
      >
        {loading ? <Loader2 size={18} className="animate-spin" aria-hidden /> : children}
      </button>
    );
  }
  return (
    <button
      className={`btn ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <Loader2 size={16} className="animate-spin" aria-hidden />
      ) : icon ? (
        <span className="shrink-0 inline-flex" aria-hidden>{icon}</span>
      ) : null}
      {children}
    </button>
  );
}
