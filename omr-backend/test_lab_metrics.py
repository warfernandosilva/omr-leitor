"""Fase 2 — Métricas, reclassificação, calibração, export e publicação.

Regras verificadas aqui:
- AMBIGUA (low/duplicate) fica FORA do denominador de acurácia (decisão do produto);
- branco conta como erro quando há gabarito;
- reclassificar usa os componentes salvos (sem reler a foto) e a MESMA regra
  de reader.classify_question;
- publicar grava data/active_config.json e get_params_override passa a lê-la.

Executar: python -m pytest test_lab_metrics.py -q
"""
import cv2
import numpy as np

from conftest import TEST_PASSWORD

from omr.lab_metrics import (
    OptionComponents, compute_metrics, confidence_gap,
    reclassify_question, grid_search,
)
from omr.template import generate_card, QUESTION_Y, PORT_X, BUBBLE_RADIUS


def _png(img):
    _, buf = cv2.imencode('.png', img)
    return buf.tobytes()


def _card_marked(answers):
    """answers: dict {questao(1-based): letra}; desenha no cartão dual (coluna LP)."""
    card = generate_card()
    letters = ["A", "B", "C", "D"]
    for q, letter in answers.items():
        if letter:
            x = PORT_X[letters.index(letter)]
            cv2.circle(card, (int(x), int(QUESTION_Y[q - 1])), int(BUBBLE_RADIUS) - 2, (15, 15, 15), -1)
    return card


def _comps(*pairs):
    return [OptionComponents(letter=l, mean_intensity=mi, dark_ratio=dr, contrast=c, otsu_threshold=0.0)
            for l, mi, dr, c in pairs]


# ---------------------------------------------------------------------------
# Métricas puras
# ---------------------------------------------------------------------------

def test_compute_metrics_ambigua_excluida_branco_erro():
    per_q = [
        {"status": "ok", "truth": "A", "detected": "A"},       # acerto
        {"status": "ok", "truth": "B", "detected": "C"},       # erro
        {"status": "blank", "truth": "A", "detected": None},   # branco = erro
        {"status": "low", "truth": "C", "detected": "C"},       # ambigua (fora do denom)
        {"status": "duplicate", "truth": "D", "detected": None},# ambigua (fora do denom)
        {"status": "ok", "truth": None, "detected": "A"},      # sem gabarito (fora)
    ]
    m = compute_metrics(per_q)
    assert m["com_gabarito"] == 5
    assert m["acertos"] == 1 and m["erros"] == 2 and m["brancos"] == 1
    assert m["ambiguas"] == 2
    assert m["respondidas"] == 3  # ok+blank (ambigua fora)
    assert abs(m["taxa_acerto"] - 1 / 3) < 1e-9
    assert abs(m["taxa_ambigua"] - 2 / 5) < 1e-9


def test_compute_metrics_empty_no_division_error():
    m = compute_metrics([])
    assert m["taxa_acerto"] is None and m["taxa_ambigua"] is None
    assert m["respondidas"] == 0


def test_confidence_gap():
    assert abs(confidence_gap({"A": 0.9, "B": 0.2}) - 0.7) < 1e-9
    assert abs(confidence_gap({"A": 0.5}) - 0.5) < 1e-9


def test_reclassify_from_components_matches_rule():
    # A claramente marcada (.9), resto vazio; floor=.30 margin=.22 -> ok
    comps = _comps(("A", 0.9, 0.85, 0.2), ("B", 0.05, 0.05, 0.0),
                   ("C", 0.05, 0.04, 0.0), ("D", 0.04, 0.04, 0.0))
    status, letter, marks, gap = reclassify_question(comps, floor=0.30, margin=0.22)
    assert status == "ok" and letter == "A" and not marks and gap > 0.5
    # floor alto -> todas abaixo => blank
    status, letter, marks, gap = reclassify_question(comps, floor=0.95, margin=0.22)
    assert status == "blank" and letter is None
    # duas marcadas próximas => duplicate
    comps2 = _comps(("A", 0.9, 0.85, 0.2), ("B", 0.88, 0.84, 0.19),
                    ("C", 0.05, 0.04, 0.0), ("D", 0.04, 0.04, 0.0))
    status, letter, marks, gap = reclassify_question(comps2, floor=0.30, margin=0.22)
    assert status == "duplicate" and set(marks) == {"A", "B"}


def test_grid_search_prefers_correct_candidate():
    # q1: A muito marcada (.74) -> correta em qualquer floor do grid
    # q2: B marcada NA MARGEM (score ~.264): com floor .30 cai abaixo (blank/erro),
    #     com floor .20 lê marcada -> correta. O grid tem de preferir floor .20.
    q1 = _comps(("A", 0.9, 0.85, 0.2), ("B", 0.05, 0.05, 0.0), ("C", 0.05, 0.04, 0.0), ("D", 0.04, 0.04, 0.0))
    q2 = _comps(("A", 0.05, 0.05, 0.0), ("B", 0.34, 0.32, 0.0), ("C", 0.05, 0.04, 0.0), ("D", 0.04, 0.04, 0.0))
    items = [{"truth": "A", "comps": q1}, {"truth": "B", "comps": q2}]
    results = grid_search(items, floor_grid=[0.20, 0.30], margin_grid=[0.10, 0.22])
    assert results, "grid devolve candidatos"
    best = results[0]
    assert best["floor"] == 0.20 and best["acertos"] == 2, best
    assert abs(best["taxa_acerto"] - 1.0) < 1e-9
    # resultados ordenados por taxa_acerto desc
    ta = [r["taxa_acerto"] for r in results]
    assert ta == sorted(ta, reverse=True)
    # floor .30 perde a q2 (fica branco/erro)
    worst = results[-1]
    assert worst["floor"] == 0.30 and worst["acertos"] == 1


# ---------------------------------------------------------------------------
# API Fase 2 — métricas/reclassify/calibration/export/publish
# ---------------------------------------------------------------------------

def _auth(client):
    r = client.post('/api/auth/register', json={
        'email': 'labm@example.com', 'nome': 'LabM', 'password': TEST_PASSWORD})
    if r.status_code == 400:
        r = client.post('/api/auth/login',
                        data={'username': 'labm@example.com', 'password': TEST_PASSWORD})
    assert r.status_code == 200, r.text
    client.headers.update({'Authorization': f"Bearer {r.json()['access_token']}"})


def test_lab_metrics_reclassify_calibration_export_publish(client, tmp_path, monkeypatch):
    from omr import params as params_module
    # isola active_config.json (não tocar no data/ real)
    active = tmp_path / "active_config.json"
    monkeypatch.setattr(params_module, "_ACTIVE_PATH", active)

    _auth(client)

    # sessão padrao dual
    r = client.post('/api/lab/sessions', json={
        'nome': 'Metricas', 'template': 'padrao', 'questions_per_subject': 22})
    assert r.status_code == 201, r.text
    sid = r.json()['id']

    # LP marcadas: q1=A q2=C q3=D (resto branco); MAT todas em branco
    answers_lp = {1: "A", 2: "C", 3: "D"}
    card = _card_marked(answers_lp)
    r = client.post(f'/api/lab/sessions/{sid}/images',
                    files=[('files', ('a.png', _png(card), 'image/png'))])
    res = [x for x in r.json()['results'] if x['status'] == 'processed']
    assert len(res) == 1, r.json()

    # gabarito: LP com as letras + MAT todas 'B' (serão brancos => erro)
    truth = {str(q): "B" for q in range(1, 45)}
    truth.update({str(k): v for k, v in answers_lp.items()})
    r = client.post(f'/api/lab/sessions/{sid}/ground-truth', json={'ground_truth': truth})
    assert r.status_code == 200, r.text

    # métricas com a classificação do motor
    r = client.get(f'/api/lab/sessions/{sid}/metrics')
    m = r.json()
    assert m["com_gabarito"] == 44
    assert m["acertos"] == 3, m  # q1,q2,q3 corretas
    assert m["respondidas"] == 44 and m["erros"] == 41
    assert abs(m["taxa_acerto"] - 3 / 44) < 1e-9

    # reclassify simulação: floor absurdamente baixo -> tudo vira marcada
    r = client.post(f'/api/lab/sessions/{sid}/reclassify',
                    json={'floor': 0.001, 'margin': 0.0, 'persist': False})
    j = r.json()
    assert j["persist"] is False
    assert j["metrics"]["brancos"] == 0, j["metrics"]

    # ...e o banco NÃO mudou (métricas iguais)
    r2 = client.get(f'/api/lab/sessions/{sid}/metrics')
    assert r2.json()["brancos"] == m["brancos"]

    # calibration: grid enxuto sobre as questões com gabarito
    r = client.post(f'/api/lab/sessions/{sid}/calibration',
                    json={'floor_grid': [0.20, 0.30], 'margin_grid': [0.15, 0.22]})
    j = r.json()
    assert r.status_code == 200, r.text
    assert j["run_id"] and j["best"]["acertos"] >= 3, j["best"]
    assert len(j["results"]) == 4

    # export json (abas) e csv (questões)
    r = client.get(f'/api/lab/sessions/{sid}/export')
    sheets = r.json()["sheets"]
    assert set(sheets) == {"metricas", "questoes", "scores"}
    assert len(sheets["questoes"]) == 45  # header + 44
    assert len(sheets["scores"]) == 1 + 44 * 4  # header + 4 por questão
    r = client.get(f'/api/lab/sessions/{sid}/export', params={'format': 'csv'})
    assert r.status_code == 200 and 'questao' in r.text

    # config: criar (não publica) -> publicar -> get_params_override lê
    r = client.post('/api/lab/configs', json={
        'nome': 'v1 floor .30', 'template': 'padrao',
        'params': {'floor': 0.30, 'margin': 0.22},
        'metrics': j['best'],
        'source_session_id': sid, 'source_run_id': j['run_id']})
    assert r.status_code == 201, r.text
    cid = r.json()['id']
    # ainda não ativa
    from omr.params import get_params_override
    assert get_params_override().is_empty()

    r = client.post(f'/api/lab/configs/{cid}/publish')
    assert r.status_code == 200 and r.json()['ativa'] is True, r.text
    p = get_params_override()
    assert p.floor == 0.30 and p.margin == 0.22 and not p.is_empty()

    # segunda config + rollback para a primeira
    r = client.post('/api/lab/configs', json={
        'nome': 'v2 floor .35', 'template': 'padrao', 'params': {'floor': 0.35, 'margin': 0.25}})
    cid2 = r.json()['id']
    client.post(f'/api/lab/configs/{cid2}/publish')
    assert get_params_override().floor == 0.35
    r = client.post(f'/api/lab/configs/{cid}/rollback')
    assert r.status_code == 200, r.text
    assert get_params_override().floor == 0.30

    # histórico: só a primeira ativa
    r = client.get('/api/lab/configs')
    j = r.json()
    ativas = [c for c in j["configs"] if c["ativa"]]
    assert len(ativas) == 1 and ativas[0]["id"] == cid

    # deactivate volta ao default
    r = client.post('/api/lab/configs/deactivate')
    assert r.status_code == 200
    assert get_params_override().is_empty()


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))