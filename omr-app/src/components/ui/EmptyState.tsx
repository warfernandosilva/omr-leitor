import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

interface Props {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}

export default function EmptyState({ title, description, action, icon }: Props) {
  return (
    <div className="empty-state">
      <div className="w-12 h-12 mx-auto mb-4 rounded-2xl bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center text-brand-500 dark:text-brand-200">
        {icon ?? <Inbox size={24} strokeWidth={1.5} aria-hidden />}
      </div>
      <p className="font-semibold text-ink dark:text-white">{title}</p>
      {description ? <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
