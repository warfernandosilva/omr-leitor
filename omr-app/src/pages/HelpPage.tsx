import { useState } from 'react';
import { BookOpen, ChevronDown, FileText, LifeBuoy, Mail, PlayCircle, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppView } from '../types';
import PageHeader from '../components/ui/PageHeader';
import Button from '../components/ui/Button';

interface Props {
  onNavigate: (view: AppView) => void;
}

const ITEMS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: BookOpen,
    title: 'Central de ajuda',
    body: 'Fluxo recomendado: 1) cadastre a Turma e importe os alunos; 2) crie a Prova e o gabarito oficial; 3) gere os cartões em PDF e imprima; 4) faça a Nova leitura com os 4 cantos visíveis; 5) revise a fila de Revisões pendentes antes de exportar.',
  },
  {
    icon: PlayCircle,
    title: 'Tutoriais em vídeo',
    body: 'Os vídeos com o passo a passo ainda estão em produção. Enquanto isso, o Banco de testes OMR mostra leituras reais com o resultado esperado de cada foto.',
  },
  {
    icon: Mail,
    title: 'Fale conosco',
    body: 'O canal direto de suporte será divulgado aqui. Para problemas de leitura, anote prova, cartão e horário — a fila de revisões guarda o que precisa de atenção.',
  },
  {
    icon: FileText,
    title: 'Termos de uso',
    body: 'O documento com as condições de utilização será publicado aqui antes da versão final.',
  },
  {
    icon: ShieldCheck,
    title: 'Política de privacidade',
    body: 'Os dados de provas e alunos ficam no seu banco (local ou servidor configurado). Nada é enviado a terceiros pelo aplicativo.',
  },
];

/** Ajuda e suporte: orientações reais e expansíveis, sem links mortos. */
export default function HelpPage({ onNavigate }: Props) {
  const [open, setOpen] = useState<string | null>(ITEMS[0].title);

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Ajuda e suporte"
        subtitle="Documentação, tutoriais e contato"
        crumbs={[{ label: 'Sistema' }, { label: 'Ajuda e suporte' }]}
      />

      <div className="card card-pad-none divide-y divide-line dark:divide-gray-800">
        {ITEMS.map(item => {
          const expanded = open === item.title;
          return (
            <div key={item.title}>
              <button
                onClick={() => setOpen(expanded ? null : item.title)}
                aria-expanded={expanded}
                className="w-full flex items-center gap-3 px-4 py-3.5 min-h-[64px] text-left"
              >
                <span className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center text-brand-600 dark:text-brand-200 shrink-0" aria-hidden>
                  <item.icon size={18} strokeWidth={2} />
                </span>
                <span className="flex-1 min-w-0 text-sm font-medium text-ink dark:text-gray-100">
                  {item.title}
                </span>
                <ChevronDown
                  size={16}
                  aria-hidden
                  className={`text-gray-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
              </button>
              {expanded && (
                <p className="px-4 pb-4 pl-[68px] text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                  {item.body}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="card text-center">
        <span className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-brand-500 flex items-center justify-center text-white" aria-hidden>
          <LifeBuoy size={24} strokeWidth={2} />
        </span>
        <h2 className="text-base font-semibold text-ink dark:text-white">Precisa de ajuda?</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-sm mx-auto">
          Fale com a nossa equipe — os canais de atendimento serão divulgados aqui.
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-2 mt-4">
          <Button variant="secondary" size="sm" onClick={() => onNavigate('home')} className="min-h-[44px]">
            Voltar ao início
          </Button>
          <Button size="sm" onClick={() => onNavigate('lab')} className="min-h-[44px]">
            Abrir banco de testes OMR
          </Button>
        </div>
      </div>
    </div>
  );
}
