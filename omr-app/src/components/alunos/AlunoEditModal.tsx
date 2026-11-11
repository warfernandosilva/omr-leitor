import { useEffect, useState } from 'react';
import { GraduationCap, Save } from 'lucide-react';
import Modal from '../ui/Modal';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import { findMatriculaConflict } from '../../utils/alunos';
import type { AlunoListItem, TurmaDTO } from '../../utils/api';

export interface AlunoDraft {
  nome: string;
  matricula: string;
  identificador_externo: string;
  turmaId: number;
}

interface Props {
  aluno: AlunoListItem | null;
  /** Todas as turmas visíveis — usadas no seletor de turma. */
  turmas: TurmaDTO[];
  /** Catálogo completo (para detectar matrícula repetida na turma). */
  alunos: AlunoListItem[];
  saving: boolean;
  /** Erro do backend (ex.: matrícula já usada por outro aluno). */
  error: string | null;
  onClose: () => void;
  onSave: (draft: AlunoDraft) => void;
}

/**
 * Edição de um aluno do catálogo: nome, matrícula, ID externo e turma.
 *
 * Regras iguais às do backend: nome é obrigatório, matrícula não pode repetir
 * dentro da mesma turma (a do próprio aluno não conta) e a troca de turma é
 * opcional. A materialização em provas é cópia — cartões já emitidos ficam
 * como estão, e o aviso no rodapé deixa isso explícito.
 */
export default function AlunoEditModal({
  aluno, turmas, alunos, saving, error, onClose, onSave,
}: Props) {
  const [nome, setNome] = useState('');
  const [matricula, setMatricula] = useState('');
  const [identificador, setIdentificador] = useState('');
  const [turmaId, setTurmaId] = useState<number | ''>('');
  const [touched, setTouched] = useState(false);

  // Recarrega o formulário sempre que abre para outro aluno.
  useEffect(() => {
    if (!aluno) return;
    setNome(aluno.nome ?? '');
    setMatricula(aluno.matricula ?? '');
    setIdentificador(aluno.identificador_externo ?? '');
    setTurmaId(aluno.turma_id);
    setTouched(false);
  }, [aluno]);

  const turmaAtual = turmaId === '' ? null : Number(turmaId);
  const conflito = aluno && turmaAtual != null
    ? findMatriculaConflict(alunos, matricula, turmaAtual, aluno.id)
    : null;
  const nomeVazio = !nome.trim();
  const invalido = nomeVazio || conflito != null;

  const submit = () => {
    setTouched(true);
    if (invalido || turmaAtual == null || !aluno) return;
    onSave({
      nome: nome.trim(),
      matricula: matricula.trim(),
      identificador_externo: identificador.trim(),
      turmaId: turmaAtual,
    });
  };

  if (!aluno) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Editar aluno"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button
            onClick={submit}
            loading={saving}
            disabled={invalido}
            icon={<Save size={15} aria-hidden />}
          >
            Salvar alterações
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Nome do aluno"
          htmlFor="aluno-edit-nome"
          required
          error={touched && nomeVazio ? 'Informe o nome do aluno.' : null}
        >
          <Input
            id="aluno-edit-nome"
            type="text"
            value={nome}
            onChange={e => setNome(e.target.value)}
            invalid={touched && nomeVazio}
            placeholder="Ex: Ana Beatriz Lima"
            autoComplete="off"
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Matrícula"
            htmlFor="aluno-edit-matricula"
            error={conflito ? `Matrícula já usada por ${conflito.nome} nesta turma.` : null}
            helper="Opcional. Deixe vazio se o aluno não tem matrícula."
          >
            <Input
              id="aluno-edit-matricula"
              type="text"
              value={matricula}
              onChange={e => setMatricula(e.target.value)}
              invalid={conflito != null}
              placeholder="Ex: 0012"
              autoComplete="off"
            />
          </Field>

          <Field
            label="Identificador externo"
            htmlFor="aluno-edit-identificador"
            helper="Opcional. Código de outro sistema (ex: ID do diário)."
          >
            <Input
              id="aluno-edit-identificador"
              type="text"
              value={identificador}
              onChange={e => setIdentificador(e.target.value)}
              placeholder="Ex: EXT-0012"
              autoComplete="off"
            />
          </Field>
        </div>

        <Field
          label="Turma"
          htmlFor="aluno-edit-turma"
          helper={turmas.length <= 1 ? 'Só existe uma turma no catálogo.' : 'Mover o aluno transfere o registro para a turma escolhida.'}
        >
          {turmas.length === 0 ? (
            <p className="text-sm text-[#71809A] dark:text-gray-400">Nenhuma turma cadastrada.</p>
          ) : (
            <Select
              id="aluno-edit-turma"
              aria-label="Turma do aluno"
              value={turmaId}
              onChange={e => setTurmaId(Number(e.target.value))}
              disabled={turmas.length === 1}
            >
              {turmas.map(t => (
                <option key={t.id} value={t.id}>{t.nome}</option>
              ))}
            </Select>
          )}
        </Field>

        {error && (
          <div className="callout-danger" role="alert">{error}</div>
        )}

        <div className="callout-info flex items-start gap-2">
          <GraduationCap size={15} className="shrink-0 mt-0.5" aria-hidden />
          <p>
            A edição vale para o catálogo de turmas. Alunos já importados em provas e
            cartões/QR já gerados <strong>não são alterados</strong> — a importação é uma
            cópia, então o nome impresso permanece o da época da geração.
          </p>
        </div>
      </div>
    </Modal>
  );
}
