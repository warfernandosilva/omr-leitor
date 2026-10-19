import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  syncExam, listTurmas, createTurma, getTurma, renameTurma,
  deleteTurma, importTurmaAlunos, materializeFromTurma,
  generateGabaritos, generateGabaritosPDF, fetchGabaritos,
} from './api';

interface Captured {
  url: string;
  init: RequestInit;
}

let captured: Captured[] = [];
let nextPayload: unknown = {};
let nextStatus = 200;

function stubFetch() {
  captured = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    captured.push({ url, init });
    return new Response(JSON.stringify(nextPayload), {
      status: nextStatus,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
}

function body(n = 0): Record<string, unknown> {
  return JSON.parse(String(captured[n].init.body));
}

const EXAM_BASE = {
  id: 'ex-1',
  name: 'Prova 1',
  subjectLP: 'LÍNGUA PORTUGUESA',
  subjectMat: 'MATEMÁTICA',
};

afterEach(() => {
  vi.unstubAllGlobals();
  nextPayload = {};
  nextStatus = 200;
});

describe('syncExam envia turma (bug do campo sempre vazio)', () => {
  it('inclui turma e turma_id no corpo do POST', async () => {
    stubFetch();
    nextPayload = { avaliacao_id: 1, external_id: 'ex-1', titulo: 'Prova 1', turma: '9º A', turma_id: 7 };
    await syncExam({ ...EXAM_BASE, turma: '9º A', turmaId: 7 });
    expect(captured).toHaveLength(1);
    expect(captured[0].url).toMatch(/\/api\/exams\/sync$/);
    expect(body()).toMatchObject({ external_id: 'ex-1', titulo: 'Prova 1', turma: '9º A', turma_id: 7 });
  });

  it('sem turma envia null explícito (limpa vínculo no servidor)', async () => {
    stubFetch();
    nextPayload = { avaliacao_id: 1, external_id: 'ex-1', titulo: 'Prova 1', turma: null, turma_id: null };
    await syncExam({ ...EXAM_BASE });
    expect(body()).toMatchObject({ turma: null, turma_id: null });
  });

  it('envia custom_template_id quando a prova usa Gabarito Personalizado', async () => {
    stubFetch();
    nextPayload = { avaliacao_id: 1, external_id: 'ex-1', titulo: 'Prova 1' };
    await syncExam({ ...EXAM_BASE, customTemplateId: 7 });
    expect(body()).toMatchObject({ custom_template_id: 7 });
  });

  it('sem modelo personalizado envia custom_template_id null', async () => {
    stubFetch();
    nextPayload = { avaliacao_id: 1, external_id: 'ex-1', titulo: 'Prova 1' };
    await syncExam({ ...EXAM_BASE });
    expect(body()).toMatchObject({ custom_template_id: null });
  });
});

describe('cliente de turmas', () => {
  it('listTurmas faz GET e devolve o array', async () => {
    stubFetch();
    nextPayload = { turmas: [{ id: 1, nome: '9º A', total_alunos: 3 }] };
    const turmas = await listTurmas();
    expect(captured[0].url).toMatch(/\/api\/turmas$/);
    expect(captured[0].init.method).toBeUndefined(); // GET padrão
    expect(turmas).toEqual([{ id: 1, nome: '9º A', total_alunos: 3 }]);
  });

  it('createTurma faz POST com o nome', async () => {
    stubFetch();
    nextPayload = { id: 2, nome: '8º B', total_alunos: 0 };
    const t = await createTurma('8º B');
    expect(captured[0].init.method).toBe('POST');
    expect(body()).toEqual({ nome: '8º B' });
    expect(t.id).toBe(2);
  });

  it('getTurma/renameTurma/deleteTurma usam os paths certos', async () => {
    stubFetch();
    nextPayload = { id: 1, nome: '9º A', total_alunos: 0, alunos: [] };
    await getTurma(1);
    expect(captured[0].url).toMatch(/\/api\/turmas\/1$/);

    nextPayload = { id: 1, nome: '9º B', total_alunos: 0 };
    await renameTurma(1, '9º B');
    expect(captured[1].init.method).toBe('PATCH');
    expect(JSON.parse(String(captured[1].init.body))).toEqual({ nome: '9º B' });

    nextPayload = { deleted: 1, alunos_removidos: 5 };
    const del = await deleteTurma(1);
    expect(captured[2].init.method).toBe('DELETE');
    expect(del).toEqual({ deleted: 1, alunos_removidos: 5 });
  });

  it('importTurmaAlunos serializa matrícula/identificador como null', async () => {
    stubFetch();
    nextPayload = { turma_id: 1, criados: 2, atualizados: 0, ignorados: 0, total_alunos: 2 };
    const r = await importTurmaAlunos(1, [{ nome: 'Ana', matricula: '10' }, { nome: 'Beto' }]);
    expect(body()).toEqual({
      alunos: [
        { nome: 'Ana', matricula: '10', identificador_externo: null },
        { nome: 'Beto', matricula: null, identificador_externo: null },
      ],
    });
    expect(r.total_alunos).toBe(2);
  });

  it('materializeFromTurma posta turma_id e repassa erro do backend', async () => {
    stubFetch();
    nextPayload = { avaliacao_id: 1, external_id: 'ex-1', turma: { id: 1, nome: '9º A' }, materializados: 3, reaproveitados: 0, total_alunos: 3 };
    const r = await materializeFromTurma('ex-1', 1);
    expect(captured[0].url).toMatch(/\/api\/exams\/ex-1\/students\/from-turma$/);
    expect(body()).toEqual({ turma_id: 1 });
    expect(r.materializados).toBe(3);

    nextStatus = 400;
    nextPayload = { detail: 'Turma sem alunos no catálogo' };
    await expect(materializeFromTurma('ex-1', 2)).rejects.toThrow('Turma sem alunos no catálogo');
  });

  it('gerar/PDF/listar por turma enviam turma_id (não mistura outras turmas)', async () => {
    stubFetch();
    nextPayload = { avaliacao_id: 1, total_alunos: 2, total_gabaritos: 2, novos_gabaritos: 2 };
    await generateGabaritos('ex-1', 7);
    expect(captured[0].url).toMatch(/\/api\/exams\/ex-1\/gabaritos\/generate\?turma_id=7$/);

    await generateGabaritosPDF('ex-1', 7);
    expect(captured[1].url).toMatch(/\/api\/exams\/ex-1\/gabaritos\/pdf\?turma_id=7$/);

    nextPayload = { avaliacao: {}, stats: {}, gabaritos: [] };
    await fetchGabaritos('ex-1', 7);
    expect(captured[2].url).toMatch(/\/api\/exams\/ex-1\/gabaritos\?turma_id=7$/);

    // sem turma mantém o comportamento anterior (todos os alunos da prova)
    nextPayload = { avaliacao_id: 1, total_alunos: 3, total_gabaritos: 3, novos_gabaritos: 0 };
    await generateGabaritos('ex-1');
    expect(captured[3].url).toMatch(/\/gabaritos\/generate$/);
  });
});
