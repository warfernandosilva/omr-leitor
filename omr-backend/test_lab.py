"""Fase 1 — Laboratório OMR: sessões, upload e persistência por bolha.

Também garante a paridade do coletor de métricas: os componentes salvos
(LabOptionScore) reproduzem exatamente os `all_ratios` dos leitores de
produção, para os 4 templates, sem divergência.

Executar: python -m pytest test_lab.py -q
"""
import cv2
import numpy as np

from conftest import TEST_PASSWORD

from omr.lab_read import run_lab_pipeline, collect_option_metrics
from omr.template import generate_card, QUESTION_Y, PORT_X, BUBBLE_RADIUS
from omr.template_sae import (
    generate_sae_card, SaeSpec, sae_block_rows,
    SAE_BLOCKS_X, SAE_BUBBLE_DX, SAE_FIRST_ROW_Y, SAE_ROW_STEP,
    SAE_BUBBLE_RADIUS,
)
from omr.template_saev import (
    generate_saev_card, SaevSpec, saev_block_rows, saev_bubble_center, SAEV_SIDE,
)
from omr.template_herby import (
    generate_herby_card, HerbySpec, herby_block_rows, herby_bubble_center,
)
from omr.template_simulado import (
    generate_simulado_card, SIMULADO_MAX_QUESTIONS, SIMULADO_INNER_R,
    simulado_bubble_center, SIMULADO_BUBBLE_R,
)


def _png(img):
    _, buf = cv2.imencode('.png', img)
    return buf.tobytes()


def _fill_padrao():
    card = generate_card()
    for q in range(22):
        x = PORT_X[(q * 7 + 3) % 4]
        cv2.circle(card, (int(x), int(QUESTION_Y[q])), int(BUBBLE_RADIUS) - 2, (15, 15, 15), -1)
    return card


def _fill_sae():
    base = generate_sae_card(SaeSpec())
    r = int(round(SAE_BUBBLE_RADIUS)) - 3
    for q, b, row in sae_block_rows(26):
        y = SAE_FIRST_ROW_Y + row * SAE_ROW_STEP
        cx = SAE_BLOCKS_X[b] + SAE_BUBBLE_DX[(q * 7 + 3) % 4]
        cv2.ellipse(base, (cx, y), (r, r), 0, 0, 360, (20, 20, 20), -1)
    return base


def _fill_saev():
    base = generate_saev_card(SaevSpec())
    half = int(SAEV_SIDE / 2) - 3
    for q, col, r in saev_block_rows(22):
        alt = (q * 7 + 3) % 4
        cx, cy = saev_bubble_center(col, r, alt, 22)
        cv2.rectangle(base, (int(cx) - half, int(cy) - half),
                      (int(cx) + half, int(cy) + half), (15, 15, 15), -1)
    return base


def _fill_herby():
    img = generate_herby_card(HerbySpec(n_questoes=22), student_name="LAB UM", qr_override="OMR-2026-000077")
    half = int(SAEV_SIDE / 2) - 6
    for q, col, r in herby_block_rows(22):
        alt = (q * 7 + 3) % 4
        cx, cy = herby_bubble_center(col, r, alt, 22)
        cv2.rectangle(img, (int(cx) - half, int(cy) - half),
                      (int(cx) + half, int(cy) + half), (10, 10, 10), -1)
    return img


def _fill_simulado():
    base = generate_simulado_card()
    r = int(SIMULADO_BUBBLE_R) - 4
    for q in range(1, SIMULADO_MAX_QUESTIONS + 1):
        cx, cy = simulado_bubble_center(q, (q * 7 + 3) % 4)
        cv2.circle(base, (int(round(cx)), int(round(cy))), r, (20, 20, 20), -1)
    return base


# ---------------------------------------------------------------------------
# Paridade do coletor de métricas com os leitores de produção
# ---------------------------------------------------------------------------

def test_collect_metrics_parity_padrao_sae_saev_herby():
    cases = [
        ("padrao", _fill_padrao(), {"questions_per_subject": 22, "layout_mode": "dual"}),
        ("sae", _fill_sae(), {"questions_per_subject": 26}),
        ("saev", _fill_saev(), {"questions_per_subject": 22}),
        ("herby", _fill_herby(), {"questions_per_subject": 22}),
        ("simulado", _fill_simulado(), {"questions_per_subject": 22}),
    ]
    for template, img, kwargs in cases:
        res = run_lab_pipeline(img, template, **kwargs)
        assert res is not None, f"{template}: leitor retornou None"
        mets = collect_option_metrics(res.rectified, template, **kwargs)
        for q, ratios in res.all_ratios.items():
            for letter, score in ratios.items():
                met = mets[q][letter]
                assert abs(met.score - score) < 1e-9, \
                    f"{template} q{q}{letter}: met.score={met.score} all_ratios={score}"


# ---------------------------------------------------------------------------
# API: sessão + upload + ground truth + delete
# ---------------------------------------------------------------------------

def test_lab_session_flow(client):
    # registro/login (o conftest já isola o DB por módulo)
    r = client.post('/api/auth/register', json={
        'email': 'lab@example.com', 'nome': 'Lab', 'password': TEST_PASSWORD})
    if r.status_code == 400:
        r = client.post('/api/auth/login',
                        data={'username': 'lab@example.com', 'password': TEST_PASSWORD})
    assert r.status_code == 200, r.text
    client.headers.update({'Authorization': f"Bearer {r.json()['access_token']}"})

    # cria sessão
    r = client.post('/api/lab/sessions', json={
        'nome': 'Turma A padrao', 'template': 'padrao',
        'questions_per_subject': 22, 'layout_mode': 'dual'})
    assert r.status_code == 201, r.text
    sid = r.json()['id']

    # upload de 2 fotos (uma boa, uma que não é cartão)
    card = _fill_padrao()
    noise = np.random.default_rng(5).integers(0, 255, (800, 600, 3), dtype=np.uint8)
    r = client.post(
        f'/api/lab/sessions/{sid}/images',
        files=[('files', ('a.png', _png(card), 'image/png')),
               ('files', ('ruido.png', _png(noise), 'image/png'))])
    j = r.json()
    assert r.status_code == 200, r.text
    ok = [x for x in j['results'] if x['status'] == 'processed']
    err = [x for x in j['results'] if x['status'] == 'error']
    assert len(ok) == 1 and len(err) == 1, j
    image_id = ok[0]['image_id']
    assert ok[0]['total_questions'] == 44  # dual: LP+MAT
    assert 'Marcadores ArUco' in err[0]['error']

    # detalhe da imagem com scores por bolha
    r = client.get(f'/api/lab/images/{image_id}')
    j = r.json()
    assert j['status'] == 'processed' and j['total_questions'] == 44
    q1 = [q for q in j['questions'] if q['question'] == 1][0]
    assert q1['status'] == 'ok' and q1['detected'] in 'ABCD'
    assert len(q1['options']) == 4
    opt = q1['options'][0]
    assert all(k in opt for k in ('score', 'mean_intensity', 'dark_ratio', 'contrast', 'otsu_threshold'))
    assert 0 <= opt['score'] <= 1 and 0 <= opt['otsu_threshold'] <= 255

    # retificada servida via FileResponse
    r = client.get(f'/api/lab/images/{image_id}/rectified')
    assert r.status_code == 200 and r.headers['content-type'].startswith('image/png')

    # ground truth (client-side parsing já feito; servidor valida e propaga)
    truth = {str(q): "ABCD"[(q * 7 + 3) % 4] for q in range(1, 45)}
    truth["999"] = "A"  # questão fora do cartão: aceita, apenas ignorada nas métricas
    r = client.post(f'/api/lab/sessions/{sid}/ground-truth', json={'ground_truth': truth})
    assert r.status_code == 200 and r.json()['ok'], r.text
    r = client.get(f'/api/lab/images/{image_id}')
    j = r.json()
    q1 = [q for q in j['questions'] if q['question'] == 1][0]
    assert q1['truth'] == truth['1']

    # listagem e exclusão
    r = client.get('/api/lab/sessions')
    assert r.status_code == 200 and len(r.json()['sessions']) == 1
    r = client.delete(f'/api/lab/sessions/{sid}')
    assert r.status_code == 200 and r.json()['ok']
    r = client.get('/api/lab/sessions')
    assert r.status_code == 200 and len(r.json()['sessions']) == 0


def test_lab_falha_de_leitura_e_persistida(client):
    """Foto que não é cartão precisa ficar na sessão (status=error).

    Sem isso, `n_erro` da listagem e `n_erro_processamento` das métricas
    mentem: o lote somme da sessão depois do reload.
    """
    r = client.post('/api/auth/register', json={
        'email': 'laberr@example.com', 'nome': 'LabErr', 'password': TEST_PASSWORD})
    if r.status_code == 400:
        r = client.post('/api/auth/login',
                        data={'username': 'laberr@example.com', 'password': TEST_PASSWORD})
    assert r.status_code == 200, r.text
    client.headers.update({'Authorization': f"Bearer {r.json()['access_token']}"})

    r = client.post('/api/lab/sessions', json={'nome': 'Com erro', 'template': 'padrao'})
    sid = r.json()['id']

    noise = np.random.default_rng(7).integers(0, 255, (800, 600, 3), dtype=np.uint8)
    r = client.post(
        f'/api/lab/sessions/{sid}/images',
        files=[('files', ('ruido.png', _png(noise), 'image/png')),
               ('files', ('vazio.png', b'x' * 10, 'image/png'))])
    assert r.status_code == 200, r.text
    errs = [x for x in r.json()['results'] if x['status'] == 'error']
    assert len(errs) == 2 and all('image_id' in e for e in errs), r.json()

    # continuam listados depois do reload
    r = client.get('/api/lab/sessions')
    s = [x for x in r.json()['sessions'] if x['id'] == sid][0]
    assert s['n_images'] == 2 and s['n_erro'] == 2, s

    # métricas contam o erro de processamento
    r = client.get(f'/api/lab/sessions/{sid}/metrics')
    m = r.json()
    assert m['n_images'] == 2 and m['n_erro_processamento'] == 2, m

    # detalhe da imagem de erro: sem questões, sem retificada
    r = client.get(f"/api/lab/images/{errs[0]['image_id']}")
    j = r.json()
    assert j['status'] == 'error' and j['questions'] == []
    assert j['rectified_url'] is None and j['error']


def test_lab_exige_autenticacao_e_isola_dono(client, db_session):
    """Todos os endpoints do Lab exigem token e respeitam o dono da sessão."""
    # o fixture `client` é module-scoped: pode ter vindo com token do teste anterior
    saved_auth = client.headers.pop('Authorization', None)
    try:
        assert client.get('/api/lab/sessions').status_code == 401
    finally:
        if saved_auth:
            client.headers['Authorization'] = saved_auth

    r = client.post('/api/auth/register', json={
        'email': 'dono@example.com', 'nome': 'Dono', 'password': TEST_PASSWORD})
    if r.status_code == 400:
        r = client.post('/api/auth/login',
                        data={'username': 'dono@example.com', 'password': TEST_PASSWORD})
    token = r.json()['access_token']

    # sem token -> 401 em leitura e escrita
    client.headers.pop('Authorization', None)
    try:
        for method, url in [
            ('get', '/api/lab/sessions'),
            ('get', '/api/lab/sessions/1'),
            ('post', '/api/lab/sessions'),
            ('post', '/api/lab/sessions/1/images'),
            ('post', '/api/lab/sessions/1/ground-truth'),
            ('get', '/api/lab/sessions/1/metrics'),
            ('get', '/api/lab/sessions/1/export'),
            ('get', '/api/lab/configs'),
            ('post', '/api/lab/configs/deactivate'),
        ]:
            fn = getattr(client, method)
            res = fn(url) if method == 'get' else fn(url, json={})
            assert res.status_code == 401, f"{method.upper()} {url} -> {res.status_code}"

        # dono cria a sessão
        client.headers['Authorization'] = f"Bearer {token}"
        sid = client.post('/api/lab/sessions', json={'nome': 'Privada'}).json()['id']

        # outro professor não vê nem mexe
        r = client.post('/api/auth/register', json={
            'email': 'outro@example.com', 'nome': 'Outro', 'password': TEST_PASSWORD})
        if r.status_code == 400:
            r = client.post('/api/auth/login',
                            data={'username': 'outro@example.com', 'password': TEST_PASSWORD})
        client.headers['Authorization'] = f"Bearer {r.json()['access_token']}"

        assert client.get('/api/lab/sessions').json()['sessions'] == []
        assert client.get(f'/api/lab/sessions/{sid}').status_code == 403
        assert client.get(f'/api/lab/sessions/{sid}/metrics').status_code == 403
        assert client.delete(f'/api/lab/sessions/{sid}').status_code == 403

        # e não consegue remover a config publicada (restrito a admin)
        assert client.post('/api/lab/configs/deactivate').status_code == 403

        # admin vê todas as sessões
        db = db_session()
        other = db.query(__import__('models').User).filter(
            __import__('models').User.email == 'outro@example.com').one()
        other.role = 'admin'
        db.commit()
        assert any(s['id'] == sid for s in client.get('/api/lab/sessions').json()['sessions'])
        assert client.post('/api/lab/configs/deactivate').status_code == 200
    finally:
        if saved_auth:
            client.headers['Authorization'] = saved_auth


def test_lab_ground_truth_invalid_keys(client):
    r = client.post('/api/auth/register', json={
        'email': 'lab2@example.com', 'nome': 'Lab2', 'password': TEST_PASSWORD})
    if r.status_code == 400:
        r = client.post('/api/auth/login',
                        data={'username': 'lab2@example.com', 'password': TEST_PASSWORD})
    assert r.status_code == 200, r.text
    client.headers.update({'Authorization': f"Bearer {r.json()['access_token']}"})

    r = client.post('/api/lab/sessions', json={'nome': 'S', 'template': 'sae'})
    sid = r.json()['id']
    r = client.post(f'/api/lab/sessions/{sid}/ground-truth',
                    json={'ground_truth': {'q1': 'A', '2': 'B'}})
    assert r.status_code == 400, r.text


def test_lab_template_invalido_rejeitado_e_linha_legada_normalizada(client, db_session):
    """Template desconhecido não pode virar leitura silenciosa com o motor errado.

    - a criação REJEITA (400) em vez de cair no fallback de normalize_template;
    - uma linha legada já gravada com template inválido continua legível: o
      leitor cai em 'padrao' e a imagem registra o template REALMENTE usado —
      senão o histórico diz um modelo e o motor rodou outro.
    """
    r = client.post('/api/auth/register', json={
        'email': 'labtpl@example.com', 'nome': 'LabTpl', 'password': TEST_PASSWORD})
    if r.status_code == 400:
        r = client.post('/api/auth/login',
                        data={'username': 'labtpl@example.com', 'password': TEST_PASSWORD})
    assert r.status_code == 200, r.text
    client.headers.update({'Authorization': f"Bearer {r.json()['access_token']}"})

    # caixa alta / typo / desconhecido -> 400 com a lista do que é válido
    for bad in ('SAEV', 'padraoo', 'qualquer'):
        r = client.post('/api/lab/sessions', json={'nome': 'Ruim', 'template': bad})
        assert r.status_code == 400, (bad, r.status_code, r.text)
        assert 'template' in r.json()['detail'], r.json()

    # legítimo -> 201 e gravado normalizado
    r = client.post('/api/lab/sessions', json={'nome': 'Boa', 'template': 'padrao'})
    assert r.status_code == 201, r.text

    # linha legada inválida (insert direto: o caminho de API agora bloqueia)
    from models import LabSession, User
    db = db_session()
    owner = db.query(User).filter(User.email == 'labtpl@example.com').one()
    legacy = LabSession(nome='Legada', template='SAEV', owner_id=owner.id)
    db.add(legacy)
    db.commit()
    db.refresh(legacy)

    card = _fill_padrao()
    r = client.post(f'/api/lab/sessions/{legacy.id}/images',
                    files=[('files', ('a.png', _png(card), 'image/png'))])
    assert r.status_code == 200, r.text
    res = r.json()['results'][0]
    assert res['status'] == 'processed', res
    assert res['template_used'] == 'padrao', (
        f"imagem registrou {res['template_used']!r} mas o motor usou 'padrao'")


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))