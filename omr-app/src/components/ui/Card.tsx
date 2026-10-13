import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  /** Remove o padding interno (útil para tabelas edge-to-edge). */
  noPad?: boolean;
}

/** Superfície elevada. Usar só quando a elevação comunica hierarquia real. */
export default function Card({ children, className = '', noPad = false }: CardProps) {
  return <section className={`card ${noPad ? 'card-pad-none' : ''} ${className}`}>{children}</section>;
}

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function CardHeader({ title, subtitle, actions }: HeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
      <div>
        <h3 className="font-semibold text-ink dark:text-white">{title}</h3>
        {subtitle ? <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}
