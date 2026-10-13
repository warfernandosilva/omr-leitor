import {
  BarChart3, ClipboardCheck, ClipboardList, FlaskConical, GraduationCap,
  KeyRound, Plus, Printer, ScanLine, ShieldCheck, TriangleAlert, Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AppView } from '../types';
import { getExams, getResults } from '../utils/storage';
import { pendingFromResults } from '../utils/pending';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';

interface Props {
  onNavigate: (view: AppView, examId?: string) => void;
}

interface QuickAction {
  title: string;
  desc: string;
  view: AppView;
  icon: LucideIcon;
}

export default function HomePage({ onNavigate }: Props) {
  const { user } = useAuth();
  const exams = getExams(user?.id);
  const results = getResults(undefined, user?.id);
  const pending = pendingFromResults(results);
  const examName = (id: string) => exams.find((e) => e.id === id)?.name ?? 'Prova';
  const avgGrade = results.length
    ? (results.reduce((acc, r) => acc + r.grade, 0) / results.length).toFixed(1)
    : '—';

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
    { title: 'Importar alunos', desc: 'Gabarito personalizado por aluno via XLSX/CSV', view: 'import-students', icon: Upload },
    { title: 'Gerenciar avaliação', desc: 'Alunos, gabaritos e status de correção', view: 'manage-exam', icon: ClipboardList },
    { title: 'Turmas', desc: 'Catálogo de alunos reutilizável entre provas', view: 'turmas', icon: GraduationCap },
    { title: 'Resultados', desc: 'Veja todas as correções realizadas', view: 'results', icon: BarChart3 },
    { title: 'Laboratório OMR', desc: 'Valide a leitura e calibre thresholds', view: 'lab', icon: FlaskConical },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Painel inicial"
        subtitle="Sistema de geração, leitura e correção de cartões-resposta"
        actions={
          <>
            <button onClick={() => onNavigate('correct-card')} className="btn btn-secondary">
              <ScanLine size={16} aria-hidden />
              Nova leitura
            </button>
            <button onClick={() => onNavigate('new-exam')} className="btn btn-primary">
              <Plus size={16} aria-hidden />
              Nova prova
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Provas criadas"
          value={exams.length}
          tone="info"
          icon={<ClipboardList size={18} aria-hidden />}
        />
        <StatCard
          label="Cartões corrigidos"
          value={results.length}
          tone="success"
          icon={<ScanLine size={18} aria-hidden />}
        />
        <StatCard
          label="Pendências de revisão"
          value={pending.length}
          tone={pending.length > 0 ? 'warning' : 'default'}
          icon={<ClipboardCheck size={18} aria-hidden />}
          hint={pending.length > 0 ? 'exigem revisão' : 'tudo revisado'}
        />
        <StatCard
          label="Média geral"
          value={avgGrade}
          icon={<BarChart3 size={18} aria-hidden />}
          hint={results.length > 0 ? `${results.length} cartão(ões)` : 'sem correções ainda'}
        />
      </div>

      {pending.length > 0 && (
        <div className="card border-warning-500/40 bg-warning-50/60 dark:bg-warning-500/5">
          <div className="flex items-start gap-3 mb-1">
            <span className="mt-0.5 w-9 h-9 rounded-xl bg-warning-100 dark:bg-warning-500/15 flex items-center justify-center text-warning-600 dark:text-warning-100 shrink-0" aria-hidden>
              <TriangleAlert size={18} />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-ink dark:text-white">
                Pendências de revisão ({pending.length})
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Cartões com dupla marcação, leitura incerta ou QR ilegível — revise antes de fechar a prova.
              </p>
            </div>
          </div>
          <div className="space-y-2 mt-3">
            {pending.map((item) => (
              <div key={item.resultId} className="flex flex-wrap items-center gap-2 p-3 bg-white dark:bg-gray-900 rounded-lg border border-warning-500/25">
                <div className="flex-1 min-w-[140px]">
                  <p className="font-medium text-ink dark:text-gray-100 text-sm">
                    {item.studentName || '(sem identificação)'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{examName(item.examId)}</p>
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
                  <button
                    onClick={() => onNavigate('view-result', item.resultId)}
                    className="btn btn-sm btn-secondary min-h-[44px]"
                  >
                    Ver
                  </button>
                  <button
                    onClick={() => onNavigate('correct-card', item.examId)}
                    className="btn btn-sm btn-primary min-h-[44px]"
                  >
                    Recorrigir
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <section aria-label="Ações rápidas">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
          Ações rápidas
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {actions.map((a) => (
            <button
              key={a.view}
              onClick={() => onNavigate(a.view)}
              className="card card-hover text-left group"
            >
              <div className="w-11 h-11 rounded-xl bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center mb-3 text-brand-600 dark:text-brand-200 group-hover:scale-105 transition-transform" aria-hidden>
                <a.icon size={22} strokeWidth={1.8} />
              </div>
              <h3 className="text-base font-semibold text-ink dark:text-white mb-0.5">{a.title}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{a.desc}</p>
            </button>
          ))}
        </div>
      </section>

      {exams.length === 0 ? (
        <EmptyState
          title="Nenhuma prova ainda"
          description="Crie sua primeira prova para começar a gerar cartões e corrigir."
          action={<button onClick={() => onNavigate('new-exam')} className="btn btn-primary">Criar prova</button>}
        />
      ) : (
        <div className="card">
          <h2 className="text-lg font-semibold text-ink dark:text-white mb-3">Provas recentes</h2>
          <div className="space-y-2">
            {exams.slice(-3).reverse().map((exam) => (
              <div key={exam.id} className="flex items-center justify-between gap-2 p-3 bg-surface dark:bg-gray-800/60 rounded-lg">
                <div className="min-w-0">
                  <p className="font-medium text-ink dark:text-gray-100 text-sm truncate">{exam.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{exam.subjectLP} + {exam.subjectMat} — {exam.totalQuestions} questões</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => onNavigate('generate-card', exam.id)}
                    className="btn btn-sm btn-secondary min-h-[44px]"
                  >
                    Cartão
                  </button>
                  <button
                    onClick={() => onNavigate('correct-card', exam.id)}
                    className="btn btn-sm btn-primary min-h-[44px]"
                  >
                    Corrigir
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
