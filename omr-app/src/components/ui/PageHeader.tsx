import type { ReactNode } from 'react';
import Breadcrumbs from './Breadcrumbs';
import type { Crumb } from './Breadcrumbs';

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  crumbs?: Crumb[];
}

export default function PageHeader({ title, subtitle, actions, crumbs }: Props) {
  return (
    <div className="mb-6">
      {crumbs && crumbs.length > 0 ? (
        <div className="mb-2"><Breadcrumbs items={crumbs} /></div>
      ) : null}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
