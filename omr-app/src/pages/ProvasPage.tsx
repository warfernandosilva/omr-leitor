import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Plus, RefreshCw, Search } from 'lucide-react';
import type { AppView } from '../types';
import { createProva, duplicarProva, listProvas, type ProvaDTO } from '../utils/api-avaliacoes';
import { createAvaliacao } from '../utils/api-avaliacoes';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import Field from '../components/ui/Field';
import { useToast } from '../components/ui/Toast';

interface Props {
  onNavigate: (view: AppView, examId?: string) => void;
}

/** Gabaritos: catálogo de provas (estrutura reutilizável em avaliações). */
export default function ProvasPage({ onNavigate }: Props) {
  const { notify } = useToast();
  const [provas, setProvas] = useState<(ProvaDTO & { avaliacoes_usando: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [criando, setCriando] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nova, setNova] = useState({ titulo: '', subjectLP: 'LÍNGUA PORTUGUESA', subjectMat: 'MATEMÁTICA', quests: 22, escala: '0-10' });

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      setProvas(await listProvas());
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao carregar as provas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return provas;
    return provas.filter(p => p.titulo.toLowerCase().includes(q)
      || (p.disciplina ?? '').toLowerCase().includes(q));
  }, [provas, busca]);

  const criar = async () => {
    if (!nova.titulo.trim()) return;
    setSaving(true);
    setErro(null);
    try {
      const prova = await createProva({
        titulo: nova.titulo.trim(),
        subjectLP: nova.subjectLP,
        subjectMat: nova.subjectMat,
        questionsPerSubject: Number(nova.quests) || 22,
        gradeScale: nova.escala,
      });
      setCriando(false);
      setNova(v => ({ ...v, titulo: '' }));
      await carregar();
      // Prova criada → segue direto para uma avaliação que a usa.
      const av = await createAvaliacao({ titulo: prova.titulo, prova_id: prova.id });
      notify('Prova criada. Avaliação iniciada com essa estrutura.', 'success');
      onNavigate('avaliacao-detalhe', av.external_id);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao criar a prova.');
    } finally {
      setSaving(false);
    }
  };

  const usarEmAvaliacao = async (prova: ProvaDTO) => {
    setErro(null);
    try {
      const av = await createAvaliacao({ titulo: prova.titulo, prova_id: prova.id });
      onNavigate('avaliacao-detalhe', av.external_id);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao criar a avaliação.');
    }
  };

  return (
    <div className="app-section animate-fade-in">
      <PageHeader
        title="Gabaritos"
        subtitle="Provas cadastradas: a estrutura (questões, disciplinas e escala) pode ser reutilizada em quantas avaliações quiser"
        actions={
          <>
            <Button variant="secondary" onClick={() => void carregar()} icon={<RefreshCw size={16} aria-hidden />}>
              Atualizar
            </Button>
            <Button onClick={() => setCriando(true)} icon={<Plus size={16} aria-hidden />}>
              Nova prova
            </Button>
          </>
        }
      />

      <Card>
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71809A] pointer-events-none" aria-hidden />
          <Input
            type="search"
            aria-label="Buscar prova"
            placeholder="Buscar por prova ou disciplina..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="!pl-9"
          />
        </div>
      </Card>

      {erro && <div className="callout-danger" role="alert">{erro}</div>}

      {loading ? (
        <Card><p className="text-sm text-[#71809A] dark:text-gray-400" role="status">Carregando provas...</p></Card>
      ) : filtradas.length === 0 ? (
        <Card>
          <EmptyState
            title={provas.length === 0 ? 'Nenhuma prova cadastrada' : 'Nenhuma prova encontrada'}
            description={provas.length === 0
              ? 'Cadastre a primeira prova para reaproveitar a estrutura em avaliações.'
              : 'Ajuste a busca.'}
            action={<Button onClick={() => setCriando(true)} icon={<Plus size={16} aria-hidden />}>Nova prova</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtradas.map(p => (
            <Card key={p.id} className="flex flex-col gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-[#172B4D] dark:text-white truncate">{p.titulo}</h3>
                <p className="text-sm text-[#71809A] dark:text-gray-400 mt-1 truncate">
                  {[p.subject_lp, p.subject_mat].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="info">{p.questions_per_subject}q/disciplina</Badge>
                <Badge tone="neutral">{p.layout_mode === 'single' ? 'pagina única' : 'pagina dupla'}</Badge>
                <Badge tone="neutral">escala {p.grade_scale}</Badge>
                <Badge tone={p.avaliacoes_usando > 0 ? 'success' : 'neutral'}>
                  {p.avaliacoes_usando} avaliação(ões)
                </Badge>
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void usarEmAvaliacao(p)}>
                  Usar em avaliação
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Copy size={14} aria-hidden />}
                  onClick={async () => {
                    try {
                      await duplicarProva(p.id);
                      await carregar();
                      notify('Estrutura duplicada (participantes e resultados não vêm junto).', 'success');
                    } catch (err) {
                      setErro(err instanceof Error ? err.message : 'Falha ao duplicar a prova.');
                    }
                  }}
                >
                  Duplicar
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={criando}
        onClose={() => setCriando(false)}
        title="Nova prova"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCriando(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={() => void criar()} loading={saving} disabled={!nova.titulo.trim()}>
              Criar e iniciar avaliação
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Título da prova" htmlFor="prova-nova-titulo" required>
            <Input
              id="prova-nova-titulo"
              type="text"
              value={nova.titulo}
              onChange={e => setNova(v => ({ ...v, titulo: e.target.value }))}
              placeholder="Ex: Matemática — 9º ano"
              autoComplete="off"
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Disciplina 1" htmlFor="prova-nova-lp">
              <Input
                id="prova-nova-lp"
                type="text"
                value={nova.subjectLP}
                onChange={e => setNova(v => ({ ...v, subjectLP: e.target.value }))}
                autoComplete="off"
              />
            </Field>
            <Field label="Disciplina 2" htmlFor="prova-nova-mat">
              <Input
                id="prova-nova-mat"
                type="text"
                value={nova.subjectMat}
                onChange={e => setNova(v => ({ ...v, subjectMat: e.target.value }))}
                autoComplete="off"
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Questões por disciplina" htmlFor="prova-nova-quests">
              <Input
                id="prova-nova-quests"
                type="number"
                min={1}
                max={26}
                value={nova.quests}
                onChange={e => setNova(v => ({ ...v, quests: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Escala de nota" htmlFor="prova-nova-escala">
              <select
                id="prova-nova-escala"
                className="input"
                value={nova.escala}
                onChange={e => setNova(v => ({ ...v, escala: e.target.value }))}
              >
                <option value="0-10">0 a 10</option>
                <option value="0-100">0 a 100</option>
                <option value="count">Acertos</option>
              </select>
            </Field>
          </div>

          <p className="field-helper">
            O gabarito oficial é cadastrado por avaliação, depois que as turmas e os alunos
            estiverem vinculados — assim cada aplicação pode ter sua própria chave.
          </p>
        </div>
      </Modal>
    </div>
  );
}
