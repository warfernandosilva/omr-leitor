import { BadgeCheck, ClipboardCheck, ScanLine } from 'lucide-react';
import type { AppView } from '../types';
import { getExams, getResults } from '../utils/storage';
import { pendingFromResults } from '../utils/pending';
import { useAuth } from '../context/AuthContext';
import PageHeader from '../components/ui/PageHeader';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';

interface Props {
  onNavigate: (view: AppView, examId?: string, resultId?: string) => void;
}

/** Fila dedicada de leituras que exigem revisão do professor. */
export default function PendingReviewsPage({ onNavigate }: Props) {
  const { user } = useAuth();
  const exams = getExams(user?.id);
  const pending = pendingFromResults(getResults(undefined, user?.id));
  const examName = (id: string) => exams.find((e) => e.id === id)?.name ?? 'Prova';

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Revisões pendentes"
        subtitle={pending.length > 0
          ? `${pending.length} leitura(s) com dúvida — revise antes de fechar a prova`
          : 'Nenhuma pendência no momento'}
        crumbs={[{ label: 'Correção OMR' }, { label: 'Revisões pendentes' }]}
      />

      {pending.length === 0 ? (
        <EmptyState
          title="Tudo revisado"
          description="Cartões com dupla marcação, leitura incerta ou QR ilegível aparecem aqui."
          icon={<BadgeCheck size={24} strokeWidth={1.5} aria-hidden />}
          action={
            <Button size="sm" onClick={() => onNavigate('results')}>
              Ver histórico de correções
            </Button>
          }
        />
      ) : (
        <>
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-2">Legenda</h2>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="warning">Múltiplas marcações</Badge>
              <Badge tone="warning">Baixa confiança</Badge>
              <Badge tone="danger">QR ilegível</Badge>
              <Badge tone="neutral">Questão em branco</Badge>
            </div>
            <p className="field-helper">
              Leitura incerta nunca conta como acerto ou erro sozinha — confirme ou corrija cada cartão.
            </p>
          </div>

          <ul className="space-y-2" aria-label="Fila de revisão">
            {pending.map((item) => (
              <li key={item.resultId} className="card !p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex-1 min-w-[140px]">
                    <p className="font-medium text-ink dark:text-gray-100 text-sm">
                      {item.studentName || '(sem identificação)'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{examName(item.examId)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {item.duplicateQuestions.length > 0 && (
                      <Badge tone="warning">
                        {item.duplicateQuestions.length} duplicada(s): Q{item.duplicateQuestions.join(', Q')}
                      </Badge>
                    )}
                    {item.lowConfidence.length > 0 && (
                      <Badge tone="warning">
                        {item.lowConfidence.length} incerta(s): Q{item.lowConfidence.join(', Q')}
                      </Badge>
                    )}
                    {item.qrIssue && <Badge tone="danger">QR ilegível</Badge>}
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 mt-3">
                  <Button
                    size="sm"
                    onClick={() => onNavigate('view-result', item.resultId)}
                    icon={<ClipboardCheck size={15} aria-hidden />}
                    className="min-h-[44px] flex-1"
                  >
                    Revisar cartão
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onNavigate('correct-card', item.examId)}
                    icon={<ScanLine size={15} aria-hidden />}
                    className="min-h-[44px] flex-1"
                  >
                    Recorrigir
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
