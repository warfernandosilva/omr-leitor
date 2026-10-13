import type { ReactNode } from 'react';
import { Users, ClipboardCheck, FileText, Settings, LifeBuoy } from 'lucide-react';
import type { AppView } from '../types';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import Badge from '../components/ui/Badge';

export type SoonView = 'alunos' | 'pending' | 'reports' | 'settings' | 'help';

const SOON_INFO: Record<SoonView, { title: string; group: string; description: string; icon: ReactNode }> = {
  alunos: {
    title: 'Alunos',
    group: 'Gerenciamento',
    description: 'Catálogo geral de alunos com busca, matrícula, turma e situação. Por enquanto, gerencie os alunos pela página de Turmas.',
    icon: <Users size={24} strokeWidth={1.5} />,
  },
  pending: {
    title: 'Revisões pendentes',
    group: 'Correção OMR',
    description: 'Fila dedicada às leituras com dupla marcação, baixa confiança ou QR ilegível. Por enquanto, as pendências aparecem no Painel inicial.',
    icon: <ClipboardCheck size={24} strokeWidth={1.5} />,
  },
  reports: {
    title: 'Relatórios',
    group: 'Análises',
    description: 'Relatório em PDF por aluno e por turma, além da distribuição de notas. Por enquanto, exporte CSV/XLSX na página de Resultados.',
    icon: <FileText size={24} strokeWidth={1.5} />,
  },
  settings: {
    title: 'Configurações',
    group: 'Sistema',
    description: 'Perfil, preferências de interface e impressão, parâmetros de leitura e backup. Esta área ainda está em construção.',
    icon: <Settings size={24} strokeWidth={1.5} />,
  },
  help: {
    title: 'Ajuda e suporte',
    group: 'Sistema',
    description: 'Documentação, perguntas frequentes e contato de suporte. Esta área ainda está em construção.',
    icon: <LifeBuoy size={24} strokeWidth={1.5} />,
  },
};

interface Props {
  view: SoonView;
  onNavigate: (view: AppView) => void;
}

/** Placeholder honesto: rotulado "Em breve", sem simular dados ou ações. */
export default function ComingSoonPage({ view, onNavigate }: Props) {
  const info = SOON_INFO[view];
  return (
    <div className="animate-fade-in">
      <PageHeader
        title={info.title}
        subtitle={info.group}
        crumbs={[{ label: info.group }, { label: info.title }]}
      />
      <EmptyState
        title={info.title}
        description={info.description}
        icon={info.icon}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <span><Badge tone="info">Em breve</Badge></span>
            <button onClick={() => onNavigate('home')} className="btn btn-primary btn-sm">
              Voltar ao início
            </button>
          </div>
        }
      />
    </div>
  );
}
