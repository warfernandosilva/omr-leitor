import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  listAvaliacoes, getAvaliacao, createAvaliacao, mudarStatus, publicarResultados,
  vincularTurma, desvincularTurma, salvarGabaritoOficial, revisarLeitura,
  listLeituras, timelineAvaliacao, resumoOperacao, listProvas, createProva,
  duplicarProva, alunoHistorico, updateAvaliacao,
} from './api-avaliacoes';

interface Capturado { url: string; init: RequestInit }
let captured: Capturado[] = [];
let payload: unknown = {};
let status = 200;

function stubFetch() {
  captured = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    captured.push({ url, init });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
}

const body = (n = 0) => JSON.parse(String(captured[n].init.body));
const AVAL = { external_id: 'aval-1', titulo: 'Avaliação', status_derivado: 'rascunho' };

afterEach(() => {
  vi.unstubAllGlobals();
  payload = {};
  status = 200;
});

describe('cliente de avaliações (ciclo de vida)', () => {
  it('listAvaliacoes monta os filtros e devolve o array', async () => {
    stubFetch();
    payload = { avaliacoes: [AVAL] };
    const out = await listAvaliacoes({ status: 'corrigida', turma_id: 3, q: 'mat' });
    expect(captured[0].url).toMatch(/\/avaliacoes\?/);
    expect(captured[0].url).toContain('status=corrigida');
    expect(captured[0].url).toContain('turma_id=3');
    expect(captured[0].url).toContain('q=mat');
    expect(captured[0].init.method).toBeUndefined();
    expect(out[0].external_id).toBe('aval-1');

    stubFetch();
    await listAvaliacoes();
    expect(captured[0].url).toMatch(/\/avaliacoes$/);
  });

  it('createAvaliacao manda prova_id e turma_ids', async () => {
    stubFetch();
    payload = AVAL;
    await createAvaliacao({ titulo: 'Avaliação 1', prova_id: 7, turma_ids: [1, 2], ano_letivo: '2026' });
    expect(captured[0].init.method).toBe('POST');
    expect(body()).toMatchObject({ titulo: 'Avaliação 1', prova_id: 7, turma_ids: [1, 2], ano_letivo: '2026' });
  });

  it('mudarStatus e publicarResultados usam PATCH/POST no recurso certo', async () => {
    stubFetch();
    payload = AVAL;
    await mudarStatus('aval-1', 'impressa');
    expect(captured[0].url).toMatch(/\/avaliacoes\/aval-1\/status$/);
    expect(captured[0].init.method).toBe('PATCH');
    expect(body()).toEqual({ status: 'impressa' });

    await publicarResultados('aval-1');
    expect(captured[1].url).toMatch(/\/avaliacoes\/aval-1\/publicar$/);
    expect(captured[1].init.method).toBe('POST');
  });

  it('salvarGabaritoOficial envia answer_key versionada', async () => {
    stubFetch();
    payload = AVAL;
    await salvarGabaritoOficial('aval-1', { 1: 'A', 2: 'B' }, 'revisão');
    expect(captured[0].url).toMatch(/\/avaliacoes\/aval-1\/gabarito$/);
    expect(body()).toEqual({ answer_key: { 1: 'A', 2: 'B' }, observacao: 'revisão' });
  });

  it('revisarLeitura grava as respostas corrigidas', async () => {
    stubFetch();
    payload = { ok: true, leitura_id: 9, status: 'revisada' };
    const r = await revisarLeitura(9, { 1: 'C' }, 'boleira');
    expect(captured[0].url).toMatch(/\/leituras\/9\/revisar$/);
    expect(body()).toEqual({ respostas: { 1: 'C' }, observacao: 'boleira' });
    expect(r.status).toBe('revisada');
  });

  it('vincular/desvincular turma usam a coleção certa', async () => {
    stubFetch();
    payload = AVAL;
    await vincularTurma('aval-1', 4);
    expect(captured[0].url).toMatch(/\/avaliacoes\/aval-1\/turmas$/);
    expect(body()).toEqual({ turma_id: 4 });

    await desvincularTurma('aval-1', 4);
    expect(captured[1].url).toMatch(/\/avaliacoes\/aval-1\/turmas\/4$/);
    expect(captured[1].init.method).toBe('DELETE');
  });

  it('listLeituras/timeline/resumo/historico leem os recursos', async () => {
    stubFetch();
    payload = { leituras: [] };
    await listLeituras('aval-1', 'pendente');
    expect(captured[0].url).toContain('/avaliacoes/aval-1/leituras?status=pendente');

    payload = { eventos: [{ tipo: 'criada', data: null }] };
    await timelineAvaliacao('aval-1');
    expect(captured[1].url).toContain('/avaliacoes/aval-1/timeline');

    payload = { avaliacoes: 1, por_status: {} };
    const resumo = await resumoOperacao();
    expect(captured[2].url).toMatch(/\/operacao\/resumo$/);
    expect(resumo.avaliacoes).toBe(1);

    payload = { aluno: { id: 1, nome: 'Ana', matricula: null, situacao: 'ativo' }, avaliacoes: [] };
    await alunoHistorico(1);
    expect(captured[3].url).toMatch(/\/alunos\/1\/historico$/);
  });

  it('provas: listar com busca, criar e duplicar', async () => {
    stubFetch();
    payload = { provas: [{ id: 1, titulo: 'P' }] };
    const provas = await listProvas('mat');
    expect(captured[0].url).toContain('/provas?q=mat');
    expect(provas[0].id).toBe(1);

    payload = { id: 2, titulo: 'Nova' };
    await createProva({ titulo: 'Nova', subjectLP: 'MATEMÁTICA' });
    expect(captured[1].init.method).toBe('POST');
    expect(body(1)).toMatchObject({ titulo: 'Nova', subjectLP: 'MATEMÁTICA' });

    payload = { id: 3, titulo: 'P (cópia)' };
    await duplicarProva(1);
    expect(captured[2].url).toMatch(/\/provas\/1\/duplicar$/);
  });

  it('updateAvaliacao manda só os campos editados', async () => {
    stubFetch();
    payload = AVAL;
    await updateAvaliacao('aval-1', { titulo: 'Novo nome', ano_letivo: '2027' });
    expect(body()).toEqual({ titulo: 'Novo nome', ano_letivo: '2027' });
  });

  it('mensagem de erro do backend chega ao chamador', async () => {
    stubFetch();
    status = 400;
    payload = { detail: 'Nenhum cartão corrigido ainda.' };
    await expect(publicarResultados('aval-1')).rejects.toThrow('Nenhum cartão corrigido ainda.');
  });

  it('getAvaliacao codifica o external_id com caracteres especiais', async () => {
    stubFetch();
    payload = AVAL;
    await getAvaliacao('aval 1/2+3');
    expect(captured[0].url).toContain('aval%201%2F2%2B3');
  });
});
