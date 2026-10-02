import PageHeader from '../ui/PageHeader';

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
      <PageHeader
        title="Laboratório OMR"
        subtitle="Banco de testes: envie fotos, informe o gabarito e meça a leitura antes de publicar qualquer configuração."
      />
      <div className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800" role="tablist">
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
                  ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              {t.label}
              {badge ? (
                <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs ${selected ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
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