"""Motor do ciclo de vida: etapas, status e transições (funções puras).

Executar: python -m pytest test_workflow_status.py -q
"""
from __future__ import annotations

import pytest

from workflow.status import (
    ARQUIVADA,
    AGUARDANDO_CORRECAO,
    AGUARDANDO_REVISAO,
    CORRIGIDA,
    EM_CORRECAO,
    EM_PREPARACAO,
    PRONTA_IMPRESSAO,
    PUBLICADOS,
    RASCUNHO,
    Contadores,
    TransicaoInvalidaError,
    aplicar_status_manual,
    calcular_fluxo,
    transicao_valida,
)

BASE = dict(alunos=30, turmas=1, tem_gabarito=True, gabarito_versao=1)


def test_sem_turma_nem_gabarito_fica_rascunho():
    f = calcular_fluxo(Contadores(arquivada=False))
    assert f.status == RASCUNHO, f.status
    assert f.progresso == 0
    assert f.proxima_acao is not None and f.proxima_acao.acao == "Concluir cadastro"
    assert any("turma" in b.lower() for b in f.bloqueios)


def test_alunos_sem_cartoes_em_preparacao():
    f = calcular_fluxo(Contadores(**BASE, cartoes_gerados=0))
    assert f.status == EM_PREPARACAO
    assert f.proxima_acao.acao == "Gerar cartões"
    # preparação pronta, todo o resto bloqueado até existir cartão
    assert [e.status for e in f.etapas] == ["concluida", "pendente", "bloqueada", "bloqueada",
                                            "bloqueada", "bloqueada"]
    assert f.etapas[1].bloqueio is None  # gerar cartões é a ação possível
    assert f.etapas[2].bloqueio == "Gere os cartões primeiro"


def test_cartoes_gerados_sem_leitura_pronta_impressao():
    f = calcular_fluxo(Contadores(**BASE, cartoes_gerados=30))
    assert f.status == PRONTA_IMPRESSAO
    assert f.etapas[1].status == "concluida"
    assert f.proxima_acao.acao == "Iniciar leitura"


def test_nenhuma_correcao_aguardando():
    f = calcular_fluxo(Contadores(**BASE, cartoes_gerados=30, cartoes_recebidos=10,
                                 cartoes_lidos=10, cartoes_corrigidos=0))
    assert f.status == AGUARDANDO_CORRECAO
    assert f.proxima_acao.acao == "Corrigir cartões"


def test_correcao_parcial_em_correcao():
    f = calcular_fluxo(Contadores(**BASE, cartoes_gerados=30, cartoes_recebidos=30,
                                 cartoes_lidos=30, cartoes_corrigidos=5))
    assert f.status == EM_CORRECAO
    assert f.progresso > 0


def test_revisoes_pendentes_tem_prioridade_sobre_corrigida():
    f = calcular_fluxo(Contadores(**BASE, cartoes_gerados=30, cartoes_recebidos=30,
                                 cartoes_lidos=30, cartoes_corrigidos=30, revisoes_pendentes=2))
    assert f.status == AGUARDANDO_REVISAO
    assert f.proxima_acao.acao == "Revisar correções"
    assert f.etapas[4].status == "atual"
    assert f.etapas[5].bloqueio


def test_tudo_corrigido_sem_pendencia_vira_corrigida():
    f = calcular_fluxo(Contadores(**BASE, cartoes_gerados=30, cartoes_recebidos=30,
                                 cartoes_lidos=30, cartoes_corrigidos=30))
    assert f.status == CORRIGIDA
    assert f.proxima_acao.acao == "Visualizar resultados"
    # 5 de 6 etapas prontas: só falta publicar os resultados
    assert f.progresso == 83


def test_publicada_atinge_progresso_total():
    f = calcular_fluxo(Contadores(**BASE, cartoes_gerados=30, cartoes_recebidos=30,
                                 cartoes_lidos=30, cartoes_corrigidos=30, resultados_publicados=1))
    assert f.status == PUBLICADOS
    assert f.progresso == 100
    assert f.proxima_acao.acao == "Ver resultados publicados"

    a = calcular_fluxo(Contadores(**BASE, arquivada=True))
    assert a.status == ARQUIVADA
    assert all(e.status == "concluida" for e in a.etapas)
    assert a.progresso == 100


def test_transicoes_manuais_autorizadas_e_bloqueadas():
    assert transicao_valida(PRONTA_IMPRESSAO, "impressa") == (True, None)
    assert transicao_valida("impressa", "em_aplicacao") == (True, None)
    assert transicao_valida(CORRIGIDA, PUBLICADOS) == (True, None)
    assert transicao_valida(CORRIGIDA, ARQUIVADA) == (True, None)

    ok, msg = transicao_valida(RASCUNHO, "impressa")
    assert ok is False and "só é possível" in msg

    with pytest.raises(TransicaoInvalidaError):
        aplicar_status_manual(RASCUNHO, PUBLICADOS)

    # marcar o mesmo status não é erro
    assert aplicar_status_manual(CORRIGIDA, CORRIGIDA) == CORRIGIDA


def test_progresso_por_etapas_concluidas():
    f = calcular_fluxo(Contadores(**BASE, cartoes_gerados=30, cartoes_recebidos=30,
                                 cartoes_lidos=30, cartoes_corrigidos=30))
    assert f.progresso == 83
    f2 = calcular_fluxo(Contadores(**BASE))
    assert f2.progresso < f.progresso
