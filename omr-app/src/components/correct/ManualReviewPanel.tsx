import type { Exam } from '../../types';
import { getSubjectIds, getSubjectName, getSubjectRange } from '../../utils/exam';
import type { AutocompleteOption } from '../ui/Autocomplete';
import type { NameCandidate } from '../../utils/api';
import type { AiSuggestionLike } from './AiAssistPanel';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Autocomplete from '../ui/Autocomplete';

export interface ReaderIdentification {
  kind: 'ok' | 'unknown' | 'wrong_exam';
  name?: string;
  cardId: string;
  examTitle?: string;
}

export interface ReviewResultLike {
  blankQuestions?: number[];
  duplicateQuestions?: number[];
  duplicateMarks?: Record<number, string[]>;
  lowConfidence?: number[];
}

interface Props {
  exam: Exam;
  result: ReviewResultLike;
  manualEntry: boolean;
  manualAnswers: Record<number, string>;
  identified: ReaderIdentification | null;
  studentName: string;
  studentsLoading: boolean;
  autoOptions: AutocompleteOption[];
  canMatchByName: boolean;
  candidates: NameCandidate[] | null;
  selectedAlunoId: number | null;
  selectedFromCatalog: boolean;
  manualInfo: string | null;
  aiSuggestions: Record<number, AiSuggestionLike>;
  onStudentNameChange: (value: string) => void;
  onPickStudent: (option: AutocompleteOption) => void;
  onChooseCandidate: (candidate: NameCandidate) => void;
  onCancelCandidates: () => void;
  onAnswer: (question: number, option: string) => void;
  onApplyAi: (question: number, letter: string) => void;
}

/**
 * Conferência/correção manual do cartão lido.
 *
 * A política de correção permanece igual: duplicada não resolvida conta como
 * erro, sugestão de IA nunca é aplicada automaticamente.
 */
export default function ManualReviewPanel({
  exam, result, manualEntry, manualAnswers, identified,
  studentName, studentsLoading, autoOptions, canMatchByName, candidates,
  selectedAlunoId, selectedFromCatalog, manualInfo, aiSuggestions,
  onStudentNameChange, onPickStudent, onChooseCandidate, onCancelCandidates,
  onAnswer, onApplyAi,
}: Props) {
  const studentHelper = identified?.kind === 'ok'
    ? 'Identificado automaticamente pelo QR Code do cartão.'
    : identified?.kind === 'unknown'
      ? 'QR Code não cadastrado neste banco — escolha ou digite o aluno.'
      : identified?.kind === 'wrong_exam'
        ? 'Este cartão pertence a outra prova. Corrija a seleção da prova antes de salvar.'
        : 'O nome é usado quando o cartão não tem QR Code ou o código não está cadastrado.';

  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-[#172B4D] dark:text-white mb-4">
        {manualEntry ? 'Preencha as respostas' : 'Conferência'}
      </h3>
      {manualEntry && (
        <p className="text-sm text-[#71809A] dark:text-gray-400 mb-4">
          Clique na alternativa marcada pelo aluno em cada questão. Clique de novo para desmarcar.
        </p>
      )}

      <div className="mb-4">
        <Field
          label="Aluno"
          htmlFor="review-student-name"
          required={identified?.kind !== 'ok'}
          helper={studentHelper}
        >
          {canMatchByName ? (
            <Autocomplete
              id="review-student-name"
              value={studentName}
              onValueChange={onStudentNameChange}
              options={autoOptions}
              onPick={onPickStudent}
              invalid={!studentName.trim()}
              ariaLabel="Aluno"
              placeholder="Digite o nome do aluno (cartão sem QR cadastrado)"
              emptyText={studentsLoading
                ? 'Carregando lista de alunos...'
                : 'Nenhum aluno encontrado — o resultado será criado para o nome digitado.'}
            />
          ) : (
            <Input
              id="review-student-name"
              type="text"
              invalid={!studentName.trim()}
              placeholder={identified?.kind === 'ok' ? identified.name : 'Digite o nome do aluno (cartão sem QR cadastrado)'}
              value={studentName}
              onChange={(e) => onStudentNameChange(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>

        {selectedAlunoId != null && !manualInfo && (
          <p className="text-xs text-success-600 dark:text-success-100 bg-success-50 dark:bg-success-700/15 border border-success-500/30 rounded-lg px-2 py-1 mt-2">
            Aluno selecionado na lista — o resultado será atribuído direto a ele.
          </p>
        )}
        {selectedAlunoId == null && selectedFromCatalog && studentName.trim() && !manualInfo && (
          <p className="text-xs text-brand-800 dark:text-brand-200 bg-brand-50 dark:bg-brand-700/15 border border-brand-500/30 rounded-lg px-2 py-1 mt-2">
            Nome do catálogo (turma ou global, ainda não importado para a prova) — o resultado será criado por nome.
          </p>
        )}
        {manualInfo && (
          <p className="text-xs text-success-600 dark:text-success-100 bg-success-50 dark:bg-success-700/15 border border-success-500/30 rounded-lg px-2 py-1 mt-2">
            {manualInfo}
          </p>
        )}

        {candidates && candidates.length > 0 && (
          <div className="mt-3 p-3 bg-warning-50 dark:bg-warning-500/10 border border-warning-500/30 rounded-lg">
            <p className="text-sm text-warning-600 dark:text-warning-100 font-medium mb-2">
              Mais de um aluno com esse nome — escolha para quem vai o resultado:
            </p>
            <div className="flex flex-col gap-1.5">
              {candidates.map(c => (
                <button
                  key={c.aluno_id}
                  type="button"
                  onClick={() => onChooseCandidate(c)}
                  className="text-left px-3 py-2 rounded-lg border border-warning-500/40 bg-white dark:bg-gray-900 hover:bg-warning-100 dark:hover:bg-warning-500/20 text-sm min-h-[44px]"
                >
                  <span className="font-medium">{c.nome}</span>
                  {c.matricula && <span className="text-[#71809A] dark:text-gray-400"> · {c.matricula}</span>}
                  <span className={`ml-2 text-xs ${c.tem_gabarito ? 'text-[#71809A] dark:text-gray-400' : 'text-warning-600 dark:text-warning-100 font-medium'}`}>
                    {c.tem_gabarito ? `cartão ${c.codigo_unico}` : 'sem cartão gerado'}
                  </span>
                </button>
              ))}
            </div>
            <button type="button" onClick={onCancelCandidates} className="mt-2 text-xs text-[#71809A] dark:text-gray-400 underline">
              Cancelar escolha
            </button>
          </div>
        )}
      </div>

      <div className="space-y-6">
        {getSubjectIds(exam).map((sid) => {
            const [start, end] = getSubjectRange(sid, exam.questionsPerSubject, exam.layoutMode);
            return (
              <div key={sid}>
                <h4 className="text-sm font-bold text-[#172B4D] dark:text-gray-200 mb-2">
                  {getSubjectName(exam, sid)} (1–{end - start + 1})
                </h4>
                <div className="table-shell">
                  <div className="table-scroll">
                    <table className="w-full text-sm">
                      <thead className="bg-[#F8FAFF] dark:bg-gray-800">
                        <tr>
                          <th className="table-th">Q</th>
                          <th className="table-th text-center">A</th>
                          <th className="table-th text-center">B</th>
                          <th className="table-th text-center">C</th>
                          <th className="table-th text-center">D</th>
                          <th className="table-th">Resposta</th>
                          <th className="table-th text-center">IA</th>
                          <th className="table-th">Gabarito</th>
                          <th className="table-th text-center">Resultado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: exam.questionsPerSubject }, (_, i) => start + i).map((q) => {
                          const selected = manualAnswers[q] || null;
                          const correctAnswer = exam.answerKey?.[q];
                          const aiS = aiSuggestions[q];
                          const aiLetter = aiS?.suggestion && /^[ABCD]$/.test(aiS.suggestion)
                            ? aiS.suggestion : null;
                          const isBlank = (result.blankQuestions ?? []).includes(q);
                          const isCorrect = selected && correctAnswer && selected === correctAnswer;
                          const isDuplicate = (result.duplicateQuestions ?? []).includes(q);
                          const isLowConf = (result.lowConfidence ?? []).includes(q);
                          const qMarks = result.duplicateMarks?.[q];

                          return (
                            <tr key={q} className={`border-b border-line/60 dark:border-gray-800 ${isLowConf || isDuplicate ? 'bg-warning-50 dark:bg-warning-500/10' : ''}`}>
                              <td className="table-td font-bold text-[#172B4D] dark:text-gray-200">
                                {String(q - start + 1).padStart(2, '0')}
                              </td>
                              {['A', 'B', 'C', 'D'].map((opt) => (
                                <td key={opt} className="table-td text-center">
                                  <button
                                    onClick={() => onAnswer(q, opt)}
                                    className={`bubble-option w-8 h-8 text-xs ${
                                      selected === opt
                                        ? 'selected'
                                        : isDuplicate && !selected && qMarks?.includes(opt)
                                          ? 'marked'
                                          : ''
                                    }`}
                                    title={isDuplicate && !selected && qMarks?.includes(opt) ? `Aluno marcou ${opt}` : undefined}
                                  >
                                    {opt}
                                  </button>
                                </td>
                              ))}
                              <td className="table-td font-medium">
                                {!selected && isDuplicate && qMarks?.length ? (
                                  <span className="text-danger-600 dark:text-danger-100">{qMarks.join(' + ')}</span>
                                ) : selected ? (
                                  selected
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-600">—</span>
                                )}
                              </td>
                              <td className="table-td text-center">
                                {aiLetter ? (
                                  <button
                                    onClick={() => onApplyAi(q, aiLetter)}
                                    className={`text-xs font-semibold rounded px-2 py-1 border ${
                                      aiLetter !== selected
                                        ? 'border-brand-500 text-brand-700 dark:text-brand-200'
                                        : 'border-line dark:border-gray-700 text-[#71809A] dark:text-gray-400'
                                    }`}
                                    title={`IA sugeriu ${aiLetter} (${Math.round((aiS?.confidence ?? 0) * 100)}%) — clique para aplicar`}
                                  >
                                    {aiLetter}
                                  </button>
                                ) : isBlank ? (
                                  <span className="text-xs text-[#71809A] dark:text-gray-400">em branco</span>
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-600">—</span>
                                )}
                              </td>
                              <td className="table-td text-[#172B4D] dark:text-gray-300">{correctAnswer || '—'}</td>
                              <td className="table-td text-center">
                                {selected ? (
                                  isCorrect ? (
                                    <span className="text-success-600 dark:text-success-100 font-medium">✓ Correta</span>
                                  ) : (
                                    <span className="text-danger-600 dark:text-danger-100 font-medium">✗ Incorreta</span>
                                  )
                                ) : isDuplicate ? (
                                  <span className="text-danger-600 dark:text-danger-100 font-medium">
                                    ✗ Incorreta{' '}
                                    <span className="text-xs">
                                      (marcou {qMarks?.length ? qMarks.join(' e ') : 'duas alternativas'})
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-xs text-[#71809A] dark:text-gray-400">Em branco</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
