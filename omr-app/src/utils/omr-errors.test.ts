import { describe, expect, it } from 'vitest';
import { classifyOmrFailure, failureMessage } from './omr-errors';

describe('classifyOmrFailure', () => {
  it('trata queda de rede como reprocessável', () => {
    const f = classifyOmrFailure(new TypeError('Failed to fetch'));
    expect(f.kind).toBe('network');
    expect(f.retryable).toBe(true);
  });

  it('trata falha de conexão relatada pela API como rede', () => {
    const f = classifyOmrFailure('Não foi possível conectar ao servidor de banco.');
    expect(f.kind).toBe('network');
    expect(f.retryable).toBe(true);
  });

  it('trata timeout como reprocessável', () => {
    const f = classifyOmrFailure('O processamento demorou mais de 2 minutos e foi interrompido.');
    expect(f.kind).toBe('timeout');
    expect(f.retryable).toBe(true);
  });

  it('trata erro 5xx como servidor', () => {
    const f = classifyOmrFailure(new Error('HTTP 502'));
    expect(f.kind).toBe('server');
    expect(f.retryable).toBe(true);
  });

  it('trata âncoras não detectadas como problema da foto', () => {
    const f = classifyOmrFailure('Âncoras Herby não encontradas (faltam: QR do cabeçalho).');
    expect(f.kind).toBe('anchor');
    expect(f.retryable).toBe(false);
  });

  it('trata falha de alinhamento do gabarito personalizado como âncora', () => {
    const f = classifyOmrFailure('Não foi possível alinhar/ler o gabarito personalizado.');
    expect(f.kind).toBe('anchor');
  });

  it('trata 4xx como recusa de processamento', () => {
    const f = classifyOmrFailure('HTTP 400: template inválido');
    expect(f.kind).toBe('processing');
    expect(f.retryable).toBe(false);
  });

  it('cai em desconhecido quando não reconhece a mensagem', () => {
    const f = classifyOmrFailure(new Error('algo inesperado'));
    expect(f.kind).toBe('unknown');
    expect(f.retryable).toBe(false);
  });

  it('aceita string vazia', () => {
    expect(classifyOmrFailure('').kind).toBe('unknown');
  });
});

describe('failureMessage', () => {
  it('junta título e dica', () => {
    const f = classifyOmrFailure('Failed to fetch');
    expect(failureMessage(f)).toBe(`${f.title} ${f.hint}`);
  });
});
