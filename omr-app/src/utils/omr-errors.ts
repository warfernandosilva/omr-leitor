/**
 * Classificação das falhas de leitura OMR.
 *
 * Separa o que é problema de infraestrutura (rede/servidor — vale reprocessar a
 * mesma captura) do que é problema da foto/modelo (precisa capturar de novo).
 * A UI usa isso para escolher a mensagem e decidir se guarda a captura na fila.
 */

export type OmrErrorKind = 'network' | 'timeout' | 'server' | 'anchor' | 'processing' | 'unknown';

export interface OmrFailure {
  kind: OmrErrorKind;
  title: string;
  hint: string;
  /** Vale tentar de novo sem refazer a foto (rede/servidor). */
  retryable: boolean;
}

const TIMEOUT_RE = /tempo esgotado|demorou mais de 2 minutos|timeout|timed out|abort/i;
const NETWORK_RE = /failed to fetch|networkerror|load failed|network request failed|fetch failed|econnrefused|enotfound|err_network|sem resposta da api|falha de rede|não foi possível conectar|nao foi possivel conectar/i;
const SERVER_RE = /http 5\d\d|internal server error|erro interno|traceback|bad gateway|service unavailable|gateway timeout/i;
const ANCHOR_RE = /anchor|âncora|ancora|alinh|marcadores|quadrados|réguas|reguas|não detectad|nao detectad|não encontr|nao encontr|faltam|retificar|borrada|não foi possível ler|nao foi possivel ler/i;
const CLIENT_RE = /http 4\d\d/i;

function messageOf(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  if (input instanceof Error) {
    return input.name && input.name !== 'Error' ? `${input.name}: ${input.message}` : input.message;
  }
  return String(input);
}

export function classifyOmrFailure(input: unknown): OmrFailure {
  const msg = messageOf(input);
  if (TIMEOUT_RE.test(msg)) {
    return {
      kind: 'timeout',
      title: 'O servidor demorou demais para responder.',
      hint: 'Tente reprocessar em instantes.',
      retryable: true,
    };
  }
  if (NETWORK_RE.test(msg)) {
    return {
      kind: 'network',
      title: 'Sem conexão com o servidor.',
      hint: 'Confira a rede e o backend; a captura pode ser reprocessada depois.',
      retryable: true,
    };
  }
  if (SERVER_RE.test(msg)) {
    return {
      kind: 'server',
      title: 'Erro no servidor ao processar a imagem.',
      hint: 'Tente reprocessar em instantes.',
      retryable: true,
    };
  }
  if (ANCHOR_RE.test(msg)) {
    return {
      kind: 'anchor',
      title: 'Não foi possível alinhar o cartão.',
      hint: 'Refaça a foto mais reta e nítida, com as quatro bordas visíveis e boa iluminação.',
      retryable: false,
    };
  }
  if (CLIENT_RE.test(msg)) {
    return {
      kind: 'processing',
      title: 'O servidor recusou a leitura.',
      hint: 'Confira a prova/modelo selecionado e tente novamente.',
      retryable: false,
    };
  }
  return {
    kind: 'unknown',
    title: 'Não foi possível ler o cartão.',
    hint: 'Tente novamente com uma foto mais nítida e iluminada.',
    retryable: false,
  };
}

/** Mensagem pronta para exibir na tela. */
export function failureMessage(f: OmrFailure): string {
  return `${f.title} ${f.hint}`.trim();
}
