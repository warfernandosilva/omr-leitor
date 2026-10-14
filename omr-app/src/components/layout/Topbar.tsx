import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  Bell, ChevronDown, ClipboardList, GraduationCap, LogOut, Menu, Search, Settings,
} from 'lucide-react';
import type { AppView } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { viewMeta } from './nav';
import { getExams, getResults } from '../../utils/storage';
import { pendingFromResults } from '../../utils/pending';
import { listTurmas } from '../../utils/api';
import type { TurmaDTO } from '../../utils/api';
import Avatar from '../ui/Avatar';
import Popover from '../ui/Popover';
import ThemeToggle from '../ui/ThemeToggle';

interface Props {
  currentView: AppView;
  /** Prova selecionada (contexto do cabeçalho nas telas de prova). */
  examId?: string | null;
  onNavigate: (view: AppView, examId?: string, resultId?: string) => void;
  onOpenMenu: () => void;
}

type Navigate = Props['onNavigate'];

function GlobalSearch({ onNavigate }: { onNavigate: Navigate }) {
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [turmas, setTurmas] = useState<TurmaDTO[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const reloadTurmas = () => {
    listTurmas().then(setTurmas).catch(() => setTurmas([]));
  };

  useEffect(() => {
    reloadTurmas();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open ]);

  const norm = q.trim().toLowerCase();
  const exams = getExams(user?.id);
  const examHits = norm ? exams.filter((e) => e.name.toLowerCase().includes(norm)).slice(0, 5) : [];
  const turmaHits = norm ? turmas.filter((t) => t.nome.toLowerCase().includes(norm)).slice(0, 5) : [];
  const hasHits = examHits.length + turmaHits.length > 0;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setQ('');
      setOpen(false);
    }
  };

  const goExam = (examId: string) => {
    setQ('');
    setOpen(false);
    onNavigate('manage-exam', examId);
  };

  const goTurmas = () => {
    setQ('');
    setOpen(false);
    onNavigate('turmas');
  };

  return (
    <div ref={rootRef} className="relative w-full">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" aria-hidden />
      <input
        type="search"
        role="searchbox"
        aria-label="Busca global"
        placeholder="Buscar prova ou turma..."
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          reloadTurmas();
          setOpen(true);
        }}
        onKeyDown={onKey}
        className="input !pl-9 !min-h-[40px]"
      />
      {open && norm ? (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-900 border border-line dark:border-gray-700 rounded-xl shadow-modal overflow-hidden">
          {!hasHits ? (
            <p className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
              Nenhum resultado para “{q.trim()}”.
            </p>
          ) : (
            <>
              {examHits.length > 0 && (
                <div className="py-1">
                  <p className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Provas</p>
                  {examHits.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => goExam(e.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-gray-700 hover:bg-surface dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      <ClipboardList size={15} className="text-gray-400 shrink-0" aria-hidden />
                      <span className="truncate">{e.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {turmaHits.length > 0 && (
                <div className="py-1 border-t border-line dark:border-gray-800">
                  <p className="px-3 pt-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Turmas</p>
                  {turmaHits.map((t) => (
                    <button
                      key={t.id}
                      onClick={goTurmas}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-gray-700 hover:bg-surface dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      <GraduationCap size={15} className="text-gray-400 shrink-0" aria-hidden />
                      <span className="truncate">{t.nome}</span>
                      <span className="text-xs text-gray-400 ml-auto shrink-0">{t.total_alunos} aluno(s)</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function Topbar({ currentView, examId, onNavigate, onOpenMenu }: Props) {
  const auth = useAuth();
  const user = auth.user;
  const userName = user?.nome || user?.email || 'Usuário';
  const exams = getExams(user?.id);
  const examName = (id: string) => exams.find((e) => e.id === id)?.name ?? 'Prova';
  const pending = pendingFromResults(getResults(undefined, user?.id));
  const meta = viewMeta(currentView);
  const contextExam = examId ? exams.find((e) => e.id === examId) : undefined;

  return (
    <header className="sticky top-0 z-30 bg-white/80 dark:bg-gray-900/80 backdrop-blur border-b border-line dark:border-gray-800">
      <div className="flex items-center gap-2 md:gap-3 px-4 py-2.5">
        <button onClick={onOpenMenu} className="btn-icon lg:hidden" aria-label="Abrir menu">
          <Menu size={20} />
        </button>
        <div className="flex-1 min-w-0 py-0.5">
          <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 leading-none truncate">{meta.group}</p>
          <p className="text-[15px] font-bold text-ink dark:text-white leading-tight truncate">
            {meta.title}
            {contextExam ? (
              <span className="font-medium text-gray-500 dark:text-gray-400"> · {contextExam.name}</span>
            ) : null}
          </p>
        </div>
        <div className="hidden sm:block w-52 md:w-72 shrink-0">
          <GlobalSearch onNavigate={onNavigate} />
        </div>

        <Popover
          triggerLabel={pending.length > 0 ? `Notificações (${pending.length} pendentes)` : 'Notificações'}
          triggerClassName="btn-icon relative"
          panelClassName="w-[320px] max-w-[calc(100vw-2rem)]"
          trigger={
            <>
              <Bell size={18} />
              {pending.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-warning-500 text-white text-[10px] font-bold flex items-center justify-center" aria-hidden>
                  {pending.length > 9 ? '9+' : pending.length}
                </span>
              )}
            </>
          }
        >
          {(close) => (
            <div>
              <p className="px-3 py-2.5 text-sm font-semibold text-ink dark:text-white border-b border-line dark:border-gray-800">
                Revisões pendentes {pending.length > 0 ? `(${pending.length})` : ''}
              </p>
              {pending.length === 0 ? (
                <p className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                  Nenhuma pendência. Leituras com dúvida aparecem aqui.
                </p>
              ) : (
                <>
                  <ul className="max-h-[300px] overflow-y-auto py-1">
                    {pending.slice(0, 5).map((p) => (
                      <li key={p.resultId}>
                        <button
                          onClick={() => {
                            close();
                            onNavigate('view-result', p.resultId);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-surface dark:hover:bg-gray-800"
                        >
                          <p className="text-sm font-medium text-ink dark:text-gray-100 truncate">
                            {p.studentName || '(sem identificação)'}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{examName(p.examId)}</p>
                          <p className="flex flex-wrap gap-1 mt-1">
                            {p.duplicateQuestions.length > 0 && (
                              <span className="text-[11px] font-medium bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">duplicada(s)</span>
                            )}
                            {p.lowConfidence.length > 0 && (
                              <span className="text-[11px] font-medium bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">incerta(s)</span>
                            )}
                            {p.qrIssue && (
                              <span className="text-[11px] font-medium bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">QR ilegível</span>
                            )}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    onClick={() => {
                      close();
                      onNavigate('pending');
                    }}
                    className="w-full px-3 py-2.5 text-sm font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-200 dark:hover:bg-gray-800 border-t border-line dark:border-gray-800"
                  >
                    Ver revisões pendentes
                  </button>
                </>
              )}
            </div>
          )}
        </Popover>

        <ThemeToggle />

        <Popover
          triggerLabel="Menu do usuário"
          triggerClassName="flex items-center gap-1.5 rounded-lg p-1 hover:bg-surface dark:hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          panelClassName="w-[240px]"
          trigger={
            <>
              <Avatar name={userName} size="sm" />
              <ChevronDown size={14} className="text-gray-400 hidden sm:block" aria-hidden />
            </>
          }
        >
          {(close) => (
            <div>
              <div className="flex items-center gap-2.5 px-3 py-3 border-b border-line dark:border-gray-800">
                <Avatar name={userName} size="md" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink dark:text-gray-100 truncate">{userName}</p>
                  <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                  <p className="text-[11px] text-gray-400">{user?.role === 'admin' ? 'Administrador' : 'Professor'}</p>
                </div>
              </div>
              <div className="py-1">
                <button
                  onClick={() => {
                    close();
                    onNavigate('settings');
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-surface dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  <Settings size={15} className="text-gray-400" aria-hidden />
                  Configurações
                </button>
                <button
                  onClick={() => auth.logout()}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-danger-600 hover:bg-danger-50 dark:text-danger-100 dark:hover:bg-danger-700/20"
                >
                  <LogOut size={15} aria-hidden />
                  Sair
                </button>
              </div>
            </div>
          )}
        </Popover>
      </div>
      <div className="sm:hidden px-4 pb-2.5">
        <GlobalSearch onNavigate={onNavigate} />
      </div>
    </header>
  );
}
