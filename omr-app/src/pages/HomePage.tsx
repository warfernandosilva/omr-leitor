import {
  BarChart3, ClipboardCheck, ClipboardList, FlaskConical, GraduationCap,
  KeyRound, Plus, Printer, ScanLine, ShieldCheck, TriangleAlert, Upload, Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AppView } from '../types';
import { getExams, getResults } from '../utils/storage';
import { listAlunos, listTurmas } from '../utils/api';
import { pendingFromResults } from '../utils/pending';
import { useAuth } from '../context/AuthContext';
import Card from '../components/ui/Card';
import StatCard from '../components/ui/StatCard';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';

interface Props {
  onNavigate: (view: AppView, examId?: string) => void;
}

interface QuickAction {
  title: string;
  desc: string;
  view: AppView;
  icon: LucideIcon;
}

interface NextStep {
  id: string;
  title: string;
  desc: string;
  examId: string;
  examName: string;
  view: AppView;
  action: string;
}

const nf = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function HomePage({ onNavigate }: Props) {
  const { user } = useAuth();
  const exams = getExams(user?.id);
  const results = getResults(undefined, user?.id);
  const pending = pendingFromResults(results);
  const examName = (id: string) => exams.find((e) => e.id === id)?.name ?? 'Prova';
  const avgGrade = results.length
    ? nf(results.reduce((acc, r) => acc + r.grade, 0) / results.length)
    : '—';
  const [turmaCount, setTurmaCount] = useState<number | null>(null);
  const [alunoCount, setAlunoCount] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [ts, as] = await Promise.all([listTurmas(), listAlunos()]);
        if (alive) {
          setTurmaCount(ts.length);
          setAlunoCount(as.length);
        }
      } catch {
        if (alive) {
          setTurmaCount(null);
          setAlunoCount(null);
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  const actions: QuickAction[] = [
    ...(user?.role === 'admin'
      ? [{
          title: 'Usuários',
          desc: 'Gerencie acesso e papéis (exclusivo admin)',
          view: 'admin-users' as AppView,
          icon: ShieldCheck,
        }]
      : []),
    { title: 'Nova prova', desc: 'Crie uma prova com questões por disciplina', view: 'new-exam', icon: Plus },
    { title: 'Corrigir cartão', desc: 'Capture ou envie a foto do cartão preenchido', view: 'correct-card', icon: ScanLine },
    { title: 'Cadastrar gabarito', desc: 'Defina as respostas corretas da prova', view: 'register-key', icon: KeyRound },
    { title: 'Gerar cartões', desc: 'Cartão-resposta em formato A4 para impressão', view: 'generate-card', icon: Printer },
    { title: 'Importar alunos', desc: 'Planilha XLSX/CSV na tela Turmas', view: 'turmas', icon: Upload },
    { title: 'Gerenciar avaliação', desc: 'Alunos, gabaritos e status de correção', view: 'manage-exam', icon: ClipboardList },
    { title: 'Turmas', desc: 'Catálogo de alunos reutilizável entre provas', view: 'turmas', icon: GraduationCap },
    { title: 'Resultados', desc: 'Veja todas as correções realizadas', view: 'results', icon: BarChart3 },
    { title: 'Laboratório OMR', desc: 'Valide a leitura e calibre thresholds', view: 'lab', icon: FlaskConical },
  ];

  const nextSteps: NextStep[] = useMemo(() => {
    const out: NextStep[] = [];
    for (const exam of exams) {
      const examResults = results.filter((r) => r.examId === exam.id);
      const examPending = pendingFromResults(examResults);
      if (!exam.answerKey) {
        out.push({
          id: `${exam.id}-key`,
          title: 'Finalizar cadastro do gabarito',
          desc: 'Defina as respostas antes de gerar os cartões',
          examId: exam.id,
          examName: exam.name,
          view: 'register-key',
          action: 'Cadastrar gabarito',
        });
      }
      if (examPending.length > 0) {
        out.push({
          id: `${exam.id}-review`,
          title: 'Revisar cartões com dúvida',
          desc: `${examPending.length} leitura(s) aguardando revisão`,
          examId: exam.id,
          examName: exam.name,
          view: 'pending',
          action: 'Revisar agora',
        });
      } else if (exam.answerKey && examResults.length === 0) {
        out.push({
          id: `${exam.id}-read`,
          title: 'Iniciar leitura dos cartões',
          desc: 'Capture ou envie a foto do cartão preenchido',
          examId: exam.id,
          examName: exam.name,
          view: 'correct-card',
          action: 'Nova leitura',
        });
      }
      if (exam.answerKey && examResults.length > 0 && examPending.length === 0) {
        out.push({
          id: `${exam.id}-results`,
          title: 'Consultar resultados da prova',
          desc: `${examResults.length} cartão(ões) corrigido(s)`,
          examId: exam.id,
          examName: exam.name,
          view: 'results',
          action: 'Ver resultados',
        });
      }
    }
    return out.slice(0, 5);
  }, [exams, results]);

  const recent = useMemo(
    () => [...results].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 6),
    [results],
  );

  return (
    <div className="app-section animate-fade-in">
      <Card className="card-glass relative overflow-hidden">
        <div className="absolute -right-12 -top-16 h-44 w-44 rounded-full bg-brand-500/10 blur-2xl" aria-hidden />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-300">Painel inicial</p>
            <h1 className="page-title mt-1">Olá! Bem-vindo ao Gabarito+</h1>
            <p className="page-subtitle max-w-2xl">
              Gerencie suas avaliações, realize correções e acompanhe o desempenho dos alunos.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<ScanLine size={16} aria-hidden />} onClick={() => onNavigate('correct-card')}>
              Nova leitura
            </Button>
            <Button icon={<Plus size={16} aria-hidden />} onClick={() => onNavigate('new-exam')}>
              Criar nova avaliação
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="Total de turmas" value={turmaCount ?? '—'} tone="info" icon={<GraduationCap size={18} aria-hidden />} />
        <StatCard label="Total de alunos" value={alunoCount ?? '—'} tone="info" icon={<Users size={18} aria-hidden />} />
        <StatCard label="Provas cadastradas" value={exams.length} tone="info" icon={<ClipboardList size={18} aria-hidden />} />
        <StatCard label="Cartões corrigidos" value={results.length} tone="success" icon={<ScanLine size={18} aria-hidden />} />
        <StatCard
          label="Revisões pendentes"
          value={pending.length}
          tone={pending.length > 0 ? 'warning' : 'default'}
          icon={<ClipboardCheck size={18} aria-hidden />}
          hint={pending.length > 0 ? 'exigem revisão' : 'tudo revisado'}
        />
        <StatCard label="Média geral" value={avgGrade} icon={<BarChart3 size={18} aria-hidden />} hint={results.length > 0 ? `${results.length} cartão(ões)` : 'sem correções ainda'} />
      </div>

      {pending.length > 0 && (
        <Card className="border-warning-500/40 bg-warning-50/60 dark:bg-warning-500/5">
          <div className="flex items-start gap-3 mb-3">
            <span className="mt-0.5 w-9 h-9 rounded-[10px] bg-warning-100 dark:bg-warning-500/15 flex items-center justify-center text-warning-600 dark:text-warning-100 shrink-0" aria-hidden>
              <TriangleAlert size={18} />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-[#172B4D] dark:text-white">
                Pendências de revisão ({pending.length})
              </h2>
              <p className="text-sm text-[#71809A] dark:text-gray-400">
                Cartões com dupla marcação, leitura incerta ou QR ilegível — revise antes de fechar a prova.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {pending.slice(0, 4).map((item) => (
              <div key={item.resultId} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-warning-500/25 bg-white p-3 dark:border-warning-500/30 dark:bg-gray-900">
                <div className="flex-1 min-w-[160px]">
                  <p className="font-medium text-[#172B4D] dark:text-gray-100 text-sm">
                    {item.studentName || '(sem identificação)'}
                  </p>
                  <p className="text-xs text-[#71809A] dark:text-gray-400">{examName(item.examId)}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {item.duplicateQuestions.length > 0 && (
                    <Badge tone="warning">{item.duplicateQuestions.length} duplicada(s)</Badge>
                  )}
                  {item.lowConfidence.length > 0 && (
                    <Badge tone="warning">{item.lowConfidence.length} incerta(s)</Badge>
                  )}
                  {item.qrIssue && <Badge tone="danger">QR ilegível</Badge>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" className="min-h-[44px]" onClick={() => onNavigate('view-result', item.resultId)}>
                    Ver
                  </Button>
                  <Button size="sm" className="min-h-[44px]" onClick={() => onNavigate('correct-card', item.examId)}>
                    Recorrigir
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <section className="app-section" aria-label="Continue de onde parou">
        <div className="section-header">
          <h2 className="section-title">Continue de onde parou</h2>
          {nextSteps.length > 0 && <span className="text-xs text-[#71809A] dark:text-gray-400">{nextSteps.length} ação(ões) sugerida(s)</span>}
        </div>
        {nextSteps.length === 0 ? (
          <EmptyState
            title="Nenhuma ação pendente"
            description="Suas provas estão com gabarito definido e leituras revisadas."
            action={<Button onClick={() => onNavigate('new-exam')}>Criar nova avaliação</Button>}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {nextSteps.map((step) => (
              <Card key={step.id} className="card-hover flex flex-col gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-[#71809A] dark:text-gray-400 truncate">{step.examName}</p>
                  <h3 className="font-semibold text-[#172B4D] dark:text-white mt-0.5">{step.title}</h3>
                  <p className="text-sm text-[#71809A] dark:text-gray-400 mt-1">{step.desc}</p>
                </div>
                <div className="mt-auto">
                  <Button size="sm" variant="secondary" onClick={() => onNavigate(step.view, step.examId)}>
                    {step.action}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="app-section" aria-label="Ações rápidas">
        <h2 className="section-title">Ações rápidas</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {actions.map((a) => (
            <button
              key={a.title}
              onClick={() => onNavigate(a.view)}
              className="quick-card group"
            >
              <div className="w-11 h-11 rounded-[10px] bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center mb-3 text-brand-600 dark:text-brand-200 group-hover:scale-105 transition-transform" aria-hidden>
                <a.icon size={22} strokeWidth={1.8} />
              </div>
              <h3 className="text-base font-semibold text-[#172B4D] dark:text-white mb-0.5">{a.title}</h3>
              <p className="text-sm text-[#71809A] dark:text-gray-400">{a.desc}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="app-section" aria-label="Atividades recentes">
        <h2 className="section-title">Atividades recentes</h2>
        {recent.length === 0 ? (
          <EmptyState
            title="Nenhuma correção recente"
            description="As leituras concluídas aparecem aqui com status e horário."
            action={<Button onClick={() => onNavigate('correct-card')}>Fazer nova leitura</Button>}
          />
        ) : (
          <Card noPad>
            <ul className="divide-y divide-line dark:divide-gray-800">
              {recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 p-4">
                  <span className="w-9 h-9 rounded-[10px] bg-success-50 dark:bg-success-700/20 flex items-center justify-center text-success-600 dark:text-success-100 shrink-0" aria-hidden>
                    <ScanLine size={18} />
                  </span>
                  <div className="flex-1 min-w-[180px]">
                    <p className="text-sm font-medium text-[#172B4D] dark:text-gray-100 truncate">
                      {r.studentName || '(sem identificação)'}
                    </p>
                    <p className="text-xs text-[#71809A] dark:text-gray-400 truncate">{examName(r.examId)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={pendingFromResults([r]).length > 0 ? 'warning' : 'success'}>
                      {pendingFromResults([r]).length > 0 ? 'Com pendência' : 'Corrigido'}
                    </Badge>
                    <Badge tone="info">Nota {nf(r.grade)}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#71809A] dark:text-gray-400 whitespace-nowrap">
                      {new Date(r.timestamp).toLocaleString('pt-BR')}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => onNavigate('view-result', r.id)}>
                      Detalhes
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
