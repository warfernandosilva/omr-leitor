export type LabTab = 'sessoes' | 'coleta' | 'revisao' | 'metricas' | 'calibracao';

interface TabDef {
  id: LabTab;
  label: string;
}

const TABS: TabDef[] = [
  { id: 'sessoes', label: 'Sessões' },
  { id: 'coleta', label: 'Coleta & Gabarito' },
  { id: 'revisao', label: 'Revisão' },
  { id: 'metricas', label: 'Métricas' },
  { id: 'calibracao', label: 'Calibração' },
];

interface Props {
  active: LabTab;
  onChange: (t: LabTab) => void;
  /** Contadores exibidos à direita do rótulo (ex.: nº de fotos com erro). */
  badges?: Partial<Record<LabTab, number>>;
}

export default function LabTabs({ active, onChange, badges }: Props) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-1 border-b border-line dark:border-gray-800" role="tablist" aria-label="Abas do laboratório">
        {TABS.map(t => {
          const badge = badges?.[t.id];
          const selected = active === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors min-h-[44px] ${
                selected
                  ? 'border-brand-500 text-brand-700 dark:text-brand-200'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              {t.label}
              {badge ? (
                <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs tabular-nums ${selected ? 'bg-brand-100 text-brand-700 dark:bg-brand-700/30 dark:text-brand-200' : 'bg-surface text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                  {badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}