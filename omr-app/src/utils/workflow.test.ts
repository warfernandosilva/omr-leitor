import { describe, expect, it } from 'vitest';
import {
  STATUS_LABEL, calcularFluxo, statusEfetivo, transicaoInvalida,
  type ContadoresFluxo,
} from './workflow';

const base: ContadoresFluxo = {
  alunos: 30, turmas: 1, temGabarito: true,
  cartoesGerados: 0, cartoesRecebidos: 0, cartoesLidos: 0,
  cartoesCorrigidos: 0, revisoesPendentes: 0,
  resultadosPublicados: false, arquivada: false,
};

describe('calcularFluxo (espelho do backend)', () => {
  it('sem turma/aluno/gabarito fica em rascunho e lista os bloqueios', () => {
    const f = calcularFluxo({
      ...base, turmas: 0, alunos: 0, temGabarito: false,
    });
    expect(f.status).toBe('rascunho');
    expect(f.bloqueios).toHaveLength(3);
    expect(f.progresso).toBe(0);
    expect(f.proximaAcao?.acao).toBe('Concluir cadastro');
  });

  it('com alunos e sem cartões fica em preparação e manda gerar cartões', () => {
    const f = calcularFluxo(base);
    expect(f.status).toBe('em_preparacao');
    expect(f.proximaAcao?.id).toBe('impressao');
    expect(f.proximaAcao?.acao).toBe('Gerar cartões');
    expect(f.etapas[0].status).toBe('concluida');
    expect(f.etapas[1].status).toBe('pendente');
    expect(f.etapas[2].status).toBe('bloqueada');
  });

  it('cartões gerados sem leitura fica pronta para impressão', () => {
    const f = calcularFluxo({ ...base, cartoesGerados: 30 });
    expect(f.status).toBe('pronta_impressao');
    expect(f.proximaAcao?.acao).toBe('Iniciar leitura');
  });

  it('leitura sem correção fica aguardando correção', () => {
    const f = calcularFluxo({ ...base, cartoesGerados: 30, cartoesRecebidos: 10, cartoesLidos: 10 });
    expect(f.status).toBe('aguardando_correcao');
    expect(f.proximaAcao?.acao).toBe('Corrigir cartões');
  });

  it('correção parcial fica em correção', () => {
    const f = calcularFluxo({
      ...base, cartoesGerados: 30, cartoesRecebidos: 30, cartoesLidos: 30, cartoesCorrigidos: 5,
    });
    expect(f.status).toBe('em_correcao');
  });

  it('revisão pendente tem prioridade e bloqueia resultados', () => {
    const f = calcularFluxo({
      ...base, cartoesGerados: 30, cartoesRecebidos: 30, cartoesLidos: 30,
      cartoesCorrigidos: 30, revisoesPendentes: 2,
    });
    expect(f.status).toBe('aguardando_revisao');
    expect(f.proximaAcao?.acao).toBe('Revisar correções');
    expect(f.etapas[4].status).toBe('atual');
    expect(f.etapas[5].status).toBe('bloqueada');
    expect(f.etapas[5].bloqueio).toContain('revisões');
  });

  it('tudo corrigido sem pendência fica corrigida e sugere publicar', () => {
    const f = calcularFluxo({
      ...base, cartoesGerados: 30, cartoesRecebidos: 30, cartoesLidos: 30, cartoesCorrigidos: 30,
    });
    expect(f.status).toBe('corrigida');
    expect(f.proximaAcao?.acao).toBe('Publicar resultados');
    expect(f.progresso).toBe(83);
  });

  it('publicada atinge 100% e arquivada conclui tudo', () => {
    const p = calcularFluxo({
      ...base, cartoesGerados: 30, cartoesRecebidos: 30, cartoesLidos: 30,
      cartoesCorrigidos: 30, resultadosPublicados: true,
    });
    expect(p.status).toBe('publicados');
    expect(p.progresso).toBe(100);

    const a = calcularFluxo({ ...base, arquivada: true });
    expect(a.status).toBe('arquivada');
    expect(a.etapas.every(e => e.status === 'concluida')).toBe(true);
  });
});

describe('transicaoInvalida', () => {
  it('permite a sequência do fluxo', () => {
    expect(transicaoInvalida('pronta_impressao', 'impressa')).toBeNull();
    expect(transicaoInvalida('impressa', 'em_aplicacao')).toBeNull();
    expect(transicaoInvalida('corrigida', 'publicados')).toBeNull();
    expect(transicaoInvalida('corrigida', 'arquivada')).toBeNull();
  });

  it('recusa salto e volta', () => {
    expect(transicaoInvalida('rascunho', 'impressa')).toContain('só é possível');
    expect(transicaoInvalida('impressa', 'pronta_impressao')).toContain('Em aplicação');
    expect(transicaoInvalida('arquivada', 'corrigida')).toContain('nenhuma');
  });

  it('mesmo status não é erro', () => {
    expect(transicaoInvalida('corrigida', 'corrigida')).toBeNull();
  });

  it('todo status tem rótulo legível em português', () => {
    for (const [chave, rotulo] of Object.entries(STATUS_LABEL)) {
      expect(rotulo.length, chave).toBeGreaterThan(3);
      expect(rotulo).not.toMatch(/_/);          // nunca expõe o código interno
      expect(rotulo[0]).toBe(rotulo[0].toUpperCase());
    }
  });
});

describe('statusEfetivo', () => {
  it('usa o mais avançado entre registrado e derivado', () => {
    expect(statusEfetivo('rascunho', 'pronta_impressao')).toBe('pronta_impressao');
    expect(statusEfetivo('impressa', 'rascunho')).toBe('impressa');
  });

  it('arquivada sempre vence', () => {
    expect(statusEfetivo('corrigida', 'arquivada')).toBe('arquivada');
    expect(statusEfetivo('arquivada', 'corrigida')).toBe('arquivada');
  });
});
