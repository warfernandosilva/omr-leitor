"""Ciclo de vida da avaliação — regras puras de status e etapas.

FONTE ÚNICA da semântica de fluxo: o backend usa estas funções para calcular
o status derivado e as etapas de cada avaliação; o frontend espelha a mesma
lógica em `src/utils/workflow.ts` para uso offline. Os dois lados são
cobertos por testes para a conta não divergir.

Regras que esta função NÃO decide (ficam nas rotas): auditoria, permissão de
owner e persistência. Aqui entra apenas o cálculo determinístico.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# ─── Estados da avaliação (ordem do fluxo) ───

RASCUNHO = "rascunho"
EM_PREPARACAO = "em_preparacao"
PRONTA_IMPRESSAO = "pronta_impressao"
IMPRESSA = "impressa"
EM_APLICACAO = "em_aplicacao"
AGUARDANDO_CORRECAO = "aguardando_correcao"
EM_CORRECAO = "em_correcao"
AGUARDANDO_REVISAO = "aguardando_revisao"
CORRIGIDA = "corrigida"
PUBLICADOS = "publicados"
ARQUIVADA = "arquivada"

STATUS_ORDEM: tuple[str, ...] = (
    RASCUNHO,
    EM_PREPARACAO,
    PRONTA_IMPRESSAO,
    IMPRESSA,
    EM_APLICACAO,
    AGUARDANDO_CORRECAO,
    EM_CORRECAO,
    AGUARDANDO_REVISAO,
    CORRIGIDA,
    PUBLICADOS,
    ARQUIVADA,
)

STATUS_LABEL: dict[str, str] = {
    RASCUNHO: "Rascunho",
    EM_PREPARACAO: "Em preparação",
    PRONTA_IMPRESSAO: "Pronta para impressão",
    IMPRESSA: "Impressa",
    EM_APLICACAO: "Em aplicação",
    AGUARDANDO_CORRECAO: "Aguardando correção",
    EM_CORRECAO: "Em correção",
    AGUARDANDO_REVISAO: "Aguardando revisão",
    CORRIGIDA: "Corrigida",
    PUBLICADOS: "Resultados publicados",
    ARQUIVADA: "Arquivada",
}

# Etapas visuais (6) — cada uma com status próprio dentro da avaliação.
ETAPA_PREPARACAO = "preparacao"
ETAPA_IMPRESSAO = "impressao"
ETAPA_APLICACAO = "aplicacao"
ETAPA_LEITURA = "leitura"
ETAPA_REVISAO = "revisao"
ETAPA_RESULTADOS = "resultados"

ETAPA_LABEL: dict[str, str] = {
    ETAPA_PREPARACAO: "Preparação",
    ETAPA_IMPRESSAO: "Impressão",
    ETAPA_APLICACAO: "Aplicação",
    ETAPA_LEITURA: "Leitura",
    ETAPA_REVISAO: "Revisão",
    ETAPA_RESULTADOS: "Resultados",
}

# Transições manuais autorizadas (status atual → status permitidos).
TRANSICOES_MANUAIS: dict[str, tuple[str, ...]] = {
    PRONTA_IMPRESSAO: (IMPRESSA, EM_APLICACAO),
    IMPRESSA: (EM_APLICACAO,),
    EM_APLICACAO: (AGUARDANDO_CORRECAO, EM_CORRECAO),
    EM_CORRECAO: (AGUARDANDO_CORRECAO, AGUARDANDO_REVISAO, CORRIGIDA),
    AGUARDANDO_REVISAO: (CORRIGIDA,),
    CORRIGIDA: (PUBLICADOS, ARQUIVADA),
    PUBLICADOS: (ARQUIVADA,),
}


class TransicaoInvalidaError(ValueError):
    """Mudança manual de status fora da sequência autorizada."""

    def __init__(self, de: str, para: str, permitidas: tuple[str, ...]):
        permitidas_txt = ", ".join(STATUS_LABEL.get(s, s) for s in permitidas) or "nenhuma"
        super().__init__(
            f"De '{STATUS_LABEL.get(de, de)}' só é possível ir para: {permitidas_txt}."
        )
        self.de = de
        self.para = para
        self.permitidas = permitidas


@dataclass
class Contadores:
    """Números reais da avaliação usados para derivar etapas e status."""

    alunos: int = 0
    turmas: int = 0
    tem_gabarito: bool = False
    gabarito_versao: int | None = None
    cartoes_gerados: int = 0
    cartoes_recebidos: int = 0          # com leitura registrada (status 'lido' ou além)
    cartoes_lidos: int = 0             # leitura concluída
    cartoes_corrigidos: int = 0         # nota calculada
    revisoes_pendentes: int = 0
    resultados_publicados: int = 0
    resultados_publicados_em: str | None = None
    arquivada: bool = False


@dataclass
class Etapa:
    id: str
    label: str
    status: str                          # 'pendente' | 'atual' | 'concluida'
    detalhe: str = ""
    acao: str | None = None              # ação contextual quando é a próxima
    habilitada: bool = True
    bloqueio: str | None = None


@dataclass
class FluxoAvaliacao:
    status: str
    etapas: list[Etapa] = field(default_factory=list)
    proxima_acao: Etapa | None = None
    bloqueios: list[str] = field(default_factory=list)
    progresso: int = 0                    # percentual de etapas concluídas (0-100)


def _etapas_base(rotulo_aplicacao: str = "Aplicar") -> list[Etapa]:
    return [
        Etapa(ETAPA_PREPARACAO, ETAPA_LABEL[ETAPA_PREPARACAO], "pendente"),
        Etapa(ETAPA_IMPRESSAO, ETAPA_LABEL[ETAPA_IMPRESSAO], "pendente"),
        Etapa(ETAPA_APLICACAO, rotulo_aplicacao, "pendente"),
        Etapa(ETAPA_LEITURA, ETAPA_LABEL[ETAPA_LEITURA], "pendente"),
        Etapa(ETAPA_REVISAO, ETAPA_LABEL[ETAPA_REVISAO], "pendente"),
        Etapa(ETAPA_RESULTADOS, ETAPA_LABEL[ETAPA_RESULTADOS], "pendente"),
    ]


def calcular_fluxo(c: Contadores) -> FluxoAvaliacao:
    """Deriva etapas, status e próxima ação a partir dos números reais.

    Determinístico e puro (sem I/O) — a mesma função roda no servidor e no
    cliente. `status` é o estado derivado pelos dados; a coluna `status` do
    banco só registra transições manais (impressa/em aplicação) e a
    arquivação, que os dados não provam sozinhos.
    """
    if c.arquivada:
        et = _etapas_base()
        for e in et:
            e.status = "concluida"
        return FluxoAvaliacao(ARQUIVADA, et, None, [], 100)

    et = _etapas_base()
    bloqueios: list[str] = []

    # ── Preparação: turmas/alunos + prova/gabarito ──
    preparacao_ok = c.alunos > 0 and c.turmas > 0 and c.tem_gabarito
    if c.turmas == 0:
        bloqueios.append("Nenhuma turma vinculada à avaliação.")
    if c.alunos == 0:
        bloqueios.append("Nenhum aluno selecionado.")
    if not c.tem_gabarito:
        bloqueios.append("Gabarito oficial não cadastrado.")
    et[0].status = "concluida" if preparacao_ok else "pendente"
    et[0].detalhe = f"{c.alunos} aluno(s) · {c.turmas} turma(s)"

    # ── Impressão: cartões gerados ──
    et[1].status = "concluida" if c.cartoes_gerados > 0 else ("bloqueada" if not preparacao_ok else "pendente")
    et[1].bloqueio = "Conclua a preparação primeiro" if not preparacao_ok else None
    et[1].detalhe = f"{c.cartoes_gerados} cartão(ões)"
    if c.cartoes_gerados == 0 and preparacao_ok:
        et[1].habilitada = True
        et[1].acao = "Gerar cartões"

    # ── Aplicação/leitura/revisão/resultados ──
    et[2].status = "concluida" if c.cartoes_recebidos > 0 else ("bloqueada" if c.cartoes_gerados == 0 else "pendente")
    et[2].bloqueio = "Gere os cartões primeiro" if c.cartoes_gerados == 0 else None
    et[2].detalhe = f"{c.cartoes_recebidos} cartão(ões) recebido(s)"

    et[3].status = "concluida" if c.cartoes_corrigidos > 0 and c.revisoes_pendentes == 0 and c.cartoes_lidos >= c.cartoes_gerados else (
        "atual" if c.cartoes_corrigidos > 0 else ("bloqueada" if c.cartoes_recebidos == 0 else "pendente")
    )
    et[3].detalhe = f"{c.cartoes_corrigidos}/{c.cartoes_gerados} corrigido(s)"

    if c.revisoes_pendentes > 0:
        et[4].status = "atual"
    elif c.cartoes_corrigidos > 0:
        et[4].status = "concluida"
    else:
        et[4].status = "bloqueada" if c.cartoes_corrigidos == 0 else "pendente"
    et[4].detalhe = f"{c.revisoes_pendentes} revisão(ões) pendente(s)"

    publicado = c.resultados_publicados > 0 or (c.resultados_publicados_em is not None)
    et[5].status = "concluida" if publicado else ("bloqueada" if c.revisoes_pendentes > 0 or c.cartoes_corrigidos == 0 else "pendente")
    et[5].bloqueio = "Resolva as revisões pendentes" if c.revisoes_pendentes > 0 else (
        "Conclua as correções" if c.cartoes_corrigidos == 0 else None
    )

    # ── Status derivado ──
    if c.cartoes_gerados == 0:
        status = EM_PREPARACAO if (c.alunos > 0) else RASCUNHO
    elif c.cartoes_recebidos == 0:
        status = PRONTA_IMPRESSAO
    elif c.revisoes_pendentes > 0:
        status = AGUARDANDO_REVISAO
    elif c.cartoes_corrigidos == 0:
        status = AGUARDANDO_CORRECAO
    elif c.cartoes_corrigidos < c.cartoes_gerados:
        status = EM_CORRECAO
    else:
        status = CORRIGIDA
    if publicado:
        status = PUBLICADOS

    # ── Próxima ação contextual ──
    proxima: Etapa | None = None
    if not preparacao_ok:
        proxima = et[0]
        proxima.acao = "Concluir cadastro"
    elif c.cartoes_gerados == 0:
        proxima = et[1]
        proxima.acao = "Gerar cartões"
    elif c.revisoes_pendentes > 0:
        proxima = et[4]
        proxima.acao = "Revisar correções"
    elif c.cartoes_corrigidos == 0 and c.cartoes_recebidos > 0:
        proxima = et[3]
        proxima.acao = "Corrigir cartões"
    elif c.cartoes_corrigidos == 0:
        proxima = et[3]
        proxima.acao = "Iniciar leitura"
    elif not publicado:
        proxima = et[5]
        proxima.acao = "Visualizar resultados"
    else:
        proxima = et[5]
        proxima.acao = "Ver resultados publicados"

    concluidas = sum(1 for e in et if e.status == "concluida")
    return FluxoAvaliacao(
        status=status,
        etapas=et,
        proxima_acao=proxima,
        bloqueios=bloqueios,
        progresso=round(concluidas * 100 / len(et)),
    )


def transicao_valida(status_atual: str, status_alvo: str) -> tuple[bool, str | None]:
    """Valida uma transição MANUAL. Devolve (ok, mensagem de erro)."""
    if status_atual == status_alvo:
        return True, None
    permitidas = TRANSICOES_MANUAIS.get(status_atual, ())
    if status_alvo in permitidas:
        return True, None
    try:
        raise TransicaoInvalidaError(status_atual, status_alvo, permitidas)
    except TransicaoInvalidaError as e:
        return False, str(e)


def aplicar_status_manual(status_atual: str, status_alvo: str) -> str:
    """Aplica a transição manual ou levanta TransicaoInvalidaError."""
    ok, err = transicao_valida(status_atual, status_alvo)
    if not ok:
        raise TransicaoInvalidaError(status_atual, status_alvo, TRANSICOES_MANUAIS.get(status_atual, ()))
    return status_alvo


def progresso_percentual(c: Contadores) -> int:
    return calcular_fluxo(c).progresso
