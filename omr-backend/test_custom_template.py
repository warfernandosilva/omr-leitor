"""Testes do Gabarito Personalizado (omr/custom_template.py + router).

Cobre: normalização/expansão/validação da configuração, leitura OMR de um
cartão sintético (mesmo motor de produção) e o fluxo completo da API
(criar → editar → validar → ativar → imprimir → testar → excluir).
"""
from __future__ import annotations

import io
import json

import cv2
import numpy as np
import pytest

from omr import custom_template as ct
from omr.template import ARUCO_DICT, _generate_aruco_marker


# ---------------------------------------------------------------------------
# Cartão sintético (ArUco 0-3 nos cantos + grade de bolhas)
# ---------------------------------------------------------------------------

PAGE_W, PAGE_H = 1000, 1400
ARUCO_SIZE = 90
ANCHOR_POS = {0: (0.10, 0.10), 1: (0.90, 0.10), 2: (0.90, 0.90), 3: (0.10, 0.90)}

# Bloco de 5 questões × 4 alternativas
B1_FX, B1_FY = 0.30, 0.32
OPT_STEP, Q_STEP, B_RADIUS = 0.085, 0.065, 0.020


def _config() -> dict:
    return {
        "page_w": PAGE_W,
        "page_h": PAGE_H,
        "anchors": [
            {"id": f"a{i}", "type": "aruco", "aruco_id": i, "corner": c,
             "x": ANCHOR_POS[i][0], "y": ANCHOR_POS[i][1],
             "size": ARUCO_SIZE / PAGE_W, "tolerance": 0.2, "required": True}
            for i, c in enumerate(["TL", "TR", "BR", "BL"])
        ],
        "qr": None,
        "info_regions": [
            {"id": "nome", "kind": "student_name", "x": 0.05, "y": 0.02, "w": 0.5, "h": 0.05},
        ],
        "questions": [
            {"id": "blk1", "type": "bubble_block", "first_x": B1_FX, "first_y": B1_FY,
             "option_step_x": OPT_STEP, "question_step_y": Q_STEP,
             "columns": 1, "n_questions": 5, "labels": ["A", "B", "C", "D"],
             "radius": B_RADIUS, "shape": "circle", "start_question": 1,
             "distribution": "column"},
        ],
        "print_fields": [
            {"region_id": "nome", "source": "student_name", "font_size": 30, "align": "left"},
        ],
        "omr_params": {},
    }


def _bubble_center(q: int, letter: str) -> tuple[float, float]:
    labels = ["A", "B", "C", "D"]
    x = B1_FX + labels.index(letter) * OPT_STEP
    y = B1_FY + (q - 1) * Q_STEP
    return x, y


def _make_card(marks: dict[int, str], skip_anchor: int | None = None,
               gray_marks: dict[tuple[int, str], int] | None = None,
               x_marks: dict[int, str] | None = None,
               check_marks: dict[int, str] | None = None) -> np.ndarray:
    img = np.ones((PAGE_H, PAGE_W, 3), dtype=np.uint8) * 255
    for mid, (nx, ny) in ANCHOR_POS.items():
        if mid == skip_anchor:
            continue
        m = _generate_aruco_marker(ARUCO_DICT, mid, ARUCO_SIZE)
        if m.ndim == 2:
            m = cv2.cvtColor(m, cv2.COLOR_GRAY2BGR)
        cx, cy = int(nx * PAGE_W), int(ny * PAGE_H)
        x0, y0 = cx - ARUCO_SIZE // 2, cy - ARUCO_SIZE // 2
        img[y0:y0 + ARUCO_SIZE, x0:x0 + ARUCO_SIZE] = m

    r_px = int(B_RADIUS * max(PAGE_W, PAGE_H))
    for q in range(1, 6):
        for letter in ["A", "B", "C", "D"]:
            nx, ny = _bubble_center(q, letter)
            cv2.circle(img, (int(nx * PAGE_W), int(ny * PAGE_H)), r_px, (0, 0, 0), 2)
    for q, letter in marks.items():
        nx, ny = _bubble_center(q, letter)
        cv2.circle(img, (int(nx * PAGE_W), int(ny * PAGE_H)), r_px - 4, (0, 0, 0), -1)
    for (q, letter), g in (gray_marks or {}).items():
        nx, ny = _bubble_center(q, letter)
        cv2.circle(img, (int(nx * PAGE_W), int(ny * PAGE_H)), r_px - 4, (g, g, g), -1)
    for q, letter in (x_marks or {}).items():
        nx, ny = _bubble_center(q, letter)
        cx, cy = int(nx * PAGE_W), int(ny * PAGE_H)
        r = r_px - 9
        cv2.line(img, (cx - r, cy - r), (cx + r, cy + r), (0, 0, 0), 5)
        cv2.line(img, (cx + r, cy - r), (cx - r, cy + r), (0, 0, 0), 5)
    for q, letter in (check_marks or {}).items():
        nx, ny = _bubble_center(q, letter)
        cx, cy = int(nx * PAGE_W), int(ny * PAGE_H)
        r = r_px - 9
        pts = np.array([[cx - r, cy + 2], [cx - r // 3, cy + r], [cx + r, cy - r]], dtype=np.int32)
        cv2.polylines(img, [pts], False, (0, 0, 0), 5)
    return img


def _png_bytes(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

def test_normalize_defaults():
    cfg = ct.normalize_config({"page_w": 100, "page_h": 200})
    assert cfg["page_w"] == 100 and cfg["page_h"] == 200
    assert cfg["anchors"] == [] and cfg["questions"] == []
    assert cfg["schema_version"] == ct.SCHEMA_VERSION


def test_normalize_clamps_and_types():
    cfg = ct.normalize_config({
        "page_w": 10, "page_h": 10,
        "anchors": [{"type": "zzz", "x": 2.0, "y": -1.0, "corner": "XX"}],
        "questions": [{"labels": [], "n_questions": -3, "columns": 0}],
    })
    a = cfg["anchors"][0]
    assert a["type"] == "quad" and a["corner"] is None
    assert a["x"] == 1.0 and a["y"] == 0.0
    b = cfg["questions"][0]
    assert b["labels"] == ["A", "B", "C", "D"] and b["n_questions"] == 0 and b["columns"] == 1


def test_expand_column_distribution():
    cfg = _config()
    bubbles = ct.expand_bubbles(cfg)
    assert len(bubbles) == 20
    # Q1 A no canto, Q2 desce uma linha
    q1 = [b for b in bubbles if b["question"] == 1]
    assert [b["option"] for b in q1] == ["A", "B", "C", "D"]
    assert q1[0]["x"] == pytest.approx(B1_FX)
    q2a = next(b for b in bubbles if b["question"] == 2 and b["option"] == "A")
    assert q2a["y"] == pytest.approx(B1_FY + Q_STEP)


def test_expand_columns_and_overrides():
    cfg = ct.normalize_config({
        "page_w": 100, "page_h": 100,
        "questions": [{
            "first_x": 0.1, "first_y": 0.1, "option_step_x": 0.05,
            "question_step_y": 0.05, "column_step_x": 0.4, "columns": 2,
            "n_questions": 4, "labels": ["A", "B"], "distribution": "column",
            "overrides": {"2": {"A": {"x": 0.9, "y": 0.9}}},
        }],
    })
    bs = ct.expand_bubbles(cfg)
    assert len(bs) == 8
    # distribuição em colunas: Q1..Q2 na coluna 0, Q3..Q4 na coluna 1
    q1 = next(b for b in bs if b["question"] == 1 and b["option"] == "A")
    q3 = next(b for b in bs if b["question"] == 3 and b["option"] == "A")
    assert q1["x"] == pytest.approx(0.1)
    assert q3["x"] == pytest.approx(0.5)
    overridden = next(b for b in bs if b["question"] == 2 and b["option"] == "A")
    assert overridden["x"] == pytest.approx(0.9) and overridden["y"] == pytest.approx(0.9)


def test_validate_clean_config_has_no_errors():
    issues = ct.validate_config(_config())
    assert not ct.has_errors(issues)


def test_validate_detects_errors():
    cfg = _config()
    cfg["questions"] = []  # sem questões
    issues = ct.validate_config(cfg)
    assert ct.has_errors(issues)
    assert any(i["code"] == "no_questions" for i in issues)


def test_validate_duplicate_question_numbers():
    cfg = _config()
    cfg["questions"].append(dict(cfg["questions"][0], id="blk2"))  # mesma numeração
    issues = ct.validate_config(cfg)
    assert any(i["code"] == "question_duplicate" and i["level"] == "error" for i in issues)


def test_validate_bubble_out_of_bounds():
    cfg = ct.normalize_config({
        "page_w": 100, "page_h": 100,
        "questions": [{"first_x": 0.99, "first_y": 0.5, "option_step_x": 0.2,
                       "question_step_y": 0.05, "n_questions": 2, "labels": ["A", "B"]}],
    })
    issues = ct.validate_config(cfg)
    assert any(i["code"] == "bubble_bounds" for i in issues)


def test_validate_warns_on_anchor_count():
    cfg = _config()
    cfg["anchors"] = cfg["anchors"][:2]
    issues = ct.validate_config(cfg)
    assert any(i["code"] == "anchors_count" and i["level"] == "warning" for i in issues)


# ---------------------------------------------------------------------------
# Leitura OMR (motor de produção)
# ---------------------------------------------------------------------------

def test_process_custom_image_reads_marked_answers():
    marks = {1: "C", 2: "A", 3: "D", 4: "B", 5: "A"}
    img = _make_card(marks)
    result = ct.process_custom_image(img, _config(), debug=True)
    assert result is not None
    for q, letter in marks.items():
        assert result.answers.get(q) == letter, f"Q{q}: esperado {letter}, obtido {result.answers.get(q)}"
    assert result.blank_questions == []
    assert result.rectified is not None
    assert result.debug_points


def test_process_custom_image_blank_when_empty():
    img = _make_card({})  # só contornos, nada preenchido
    result = ct.process_custom_image(img, _config())
    assert result is not None
    assert result.answers == {}
    assert set(result.blank_questions) == {1, 2, 3, 4, 5}


def test_process_custom_image_detects_duplicate():
    img = _make_card({2: "A"})
    # preenche também B da Q2 → dupla marcação
    nx, ny = _bubble_center(2, "B")
    r_px = int(B_RADIUS * max(PAGE_W, PAGE_H)) - 4
    cv2.circle(img, (int(nx * PAGE_W), int(ny * PAGE_H)), r_px, (0, 0, 0), -1)
    result = ct.process_custom_image(img, _config())
    assert result is not None
    assert 2 in result.duplicate_questions


def test_detect_anchor_corners_aruco():
    img = _make_card({})
    corners, reason = ct.detect_anchor_corners(img, _config())
    assert corners is not None, reason
    assert set(corners) == {"TL", "TR", "BR", "BL"}
    # TL perto de (0.1, 0.1)
    assert corners["TL"][0] == pytest.approx(0.1 * PAGE_W, abs=6)
    assert corners["TL"][1] == pytest.approx(0.1 * PAGE_H, abs=6)


# ---------------------------------------------------------------------------
# P0: inferência da 4ª âncora + confiança de alinhamento
# ---------------------------------------------------------------------------

def _config_shifted(dx: float) -> dict:
    """Config com o bloco de questões deslocado (simula grade errada)."""
    cfg = _config()
    cfg["questions"][0]["first_x"] = B1_FX + dx
    return cfg


def _rectify(img: np.ndarray, cfg: dict) -> np.ndarray:
    M, cw, ch, reason, _meta = ct.build_homography_ex(img, cfg)
    assert M is not None, reason
    return cv2.warpPerspective(img, M, (cw, ch))


def test_infer_missing_corner_parallelogram():
    found = {"TL": (100.0, 140.0), "TR": (900.0, 140.0), "BR": (900.0, 1260.0)}
    out = ct._infer_missing_corner(found, PAGE_W, PAGE_H)
    assert out is not None
    corner, (x, y) = out
    assert corner == "BL"
    assert x == pytest.approx(100.0, abs=1e-6)
    assert y == pytest.approx(1260.0, abs=1e-6)


def test_infer_missing_corner_rejects_degenerate():
    found = {"TL": (0.0, 0.0), "TR": (100.0, 0.0), "BR": (200.0, 0.0)}  # colineares
    assert ct._infer_missing_corner(found, PAGE_W, PAGE_H) is None
    # só 2 pontos conhecidos → não infere
    assert ct._infer_missing_corner({"TL": (0.0, 0.0), "TR": (100.0, 0.0)}, PAGE_W, PAGE_H) is None


def test_three_anchors_detected_infer_fourth_and_read():
    marks = {1: "C", 2: "A", 3: "D", 4: "B", 5: "A"}
    img = _make_card(marks, skip_anchor=3)  # âncora BL ausente na imagem
    corners, reason, meta = ct._detect_anchor_corners_ex(img, _config())
    assert corners is not None, reason
    assert set(corners) == {"TL", "TR", "BR", "BL"}
    assert meta["inferred"] == ["BL"]
    assert meta["method"] == "anchors"

    result = ct.process_custom_image(img, _config())
    assert result is not None
    for q, letter in marks.items():
        assert result.answers.get(q) == letter, f"Q{q}: obtido {result.answers.get(q)}"
    assert result.alignment is not None and result.alignment["ok"] is True


def test_no_inference_when_config_expects_only_three_anchors():
    cfg = _config()
    cfg["anchors"] = cfg["anchors"][:3]  # TL, TR, BR apenas
    img = _make_card({}, skip_anchor=3)
    _M, _cw, _ch, _reason, meta = ct.build_homography_ex(img, cfg)
    # Não inventa a 4ª âncora quando a config só prevê 3.
    assert meta["inferred"] == []


def test_check_alignment_accepts_correct_grid():
    img = _make_card({1: "A"})
    rect = _rectify(img, _config())
    diag = ct.check_alignment(cv2.cvtColor(rect, cv2.COLOR_BGR2GRAY), ct.normalize_config(_config()))
    assert diag["ok"] is True
    assert diag["method"] == "grid"
    assert diag["precision"] is not None and diag["precision"] >= 0.6


def test_check_alignment_rejects_shifted_grid():
    img = _make_card({1: "A"})
    rect = _rectify(img, _config())
    diag = ct.check_alignment(cv2.cvtColor(rect, cv2.COLOR_BGR2GRAY),
                              ct.normalize_config(_config_shifted(0.06)))
    assert diag["ok"] is False
    assert diag["method"] == "grid"
    assert diag["precision"] is not None and diag["precision"] < 0.6


def test_process_rejects_shifted_grid_with_diagnostics():
    img = _make_card({1: "A"})
    diag: dict = {}
    result = ct.process_custom_image(img, _config_shifted(0.06), diagnostics=diag)
    assert result is None
    assert diag["reason"] == "alignment"
    assert diag["alignment"] is not None and diag["alignment"]["ok"] is False


def test_process_shifted_grid_allowed_when_not_strict():
    img = _make_card({1: "A"})
    result = ct.process_custom_image(img, _config_shifted(0.06), strict_alignment=False)
    assert result is not None
    assert result.alignment is not None and result.alignment["ok"] is False


def test_api_test_endpoint_reports_alignment(authed):
    client = authed
    r = _create(client, _png_bytes(_make_card({})), "Alinhamento")
    tid = r.json()["id"]
    client.put(f"/api/custom-templates/{tid}", json={"config": _config()})
    r = client.post(
        f"/api/custom-templates/{tid}/test",
        files={"file": ("foto.png", _png_bytes(_make_card({1: "C"})), "image/png")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True, body
    assert body["alignment"]["ok"] is True
    client.delete(f"/api/custom-templates/{tid}")


def test_api_test_endpoint_reports_misalignment(authed):
    client = authed
    r = _create(client, _png_bytes(_make_card({})), "Desalinhado")
    tid = r.json()["id"]
    client.put(f"/api/custom-templates/{tid}", json={"config": _config_shifted(0.06)})
    r = client.post(
        f"/api/custom-templates/{tid}/test",
        files={"file": ("foto.png", _png_bytes(_make_card({1: "C"})), "image/png")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is False, body
    assert body["failure"]["reason"] == "alignment"
    assert body["alignment"]["ok"] is False
    client.delete(f"/api/custom-templates/{tid}")


def test_render_overlay_draws_text_and_qr():
    img = _make_card({})
    out = ct.render_overlay(_config(), img, fields={"student_name": "Fulano de Tal"},
                            qr_payload="OMR-2026-000001")
    assert out.shape == img.shape
    assert not np.array_equal(out, img)  # algo foi desenhado


def test_config_summary():
    s = ct.config_summary(_config())
    assert s["n_anchors"] == 4 and s["n_questions"] == 5 and s["n_blocks"] == 1


# ---------------------------------------------------------------------------
# API (fluxo completo)
# ---------------------------------------------------------------------------

def _create(client, img_bytes: bytes, nome: str = "Meu cartão", avaliacao_external_id: str | None = None):
    data = {"nome": nome}
    if avaliacao_external_id:
        data["avaliacao_external_id"] = avaliacao_external_id
    return client.post(
        "/api/custom-templates",
        files={"file": ("card.png", img_bytes, "image/png")},
        data=data,
    )


def test_api_flow(authed):
    client = authed
    blank = _make_card({})
    r = _create(client, _png_bytes(blank))
    assert r.status_code == 201, r.text
    tpl = r.json()
    tid = tpl["id"]
    assert tpl["image_w"] == PAGE_W and tpl["image_h"] == PAGE_H
    assert tpl["status"] == "rascunho"

    # salvar a configuração desenhada no editor
    r = client.put(f"/api/custom-templates/{tid}", json={"config": _config()})
    assert r.status_code == 200, r.text
    cfg = r.json()["config"]
    assert len(cfg["questions"]) == 1

    # validação sem erros
    r = client.post(f"/api/custom-templates/{tid}/validate")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True, body
    assert body["summary"]["n_questions"] == 5

    # bolhas expandidas para o editor
    r = client.get(f"/api/custom-templates/{tid}/bubbles")
    assert r.status_code == 200 and len(r.json()["bubbles"]) == 20

    # ativar → cria versão imutável + status ativo
    r = client.post(f"/api/custom-templates/{tid}/activate")
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True and r.json()["version"] == 1
    r = client.get(f"/api/custom-templates/{tid}/versions")
    assert len(r.json()["versions"]) == 1

    # imprimir em branco (PDF)
    r = client.post(f"/api/custom-templates/{tid}/print",
                    json={"mode": "blank", "format": "PDF"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert len(r.content) > 1000

    # imprimir cartões por lista (nome + QR)
    r = client.post(f"/api/custom-templates/{tid}/print",
                    json={"mode": "students", "format": "PDF",
                          "students": [{"nome": "Ana"}, {"nome": "Bruno"}]})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"

    # testar com a foto preenchida + gabarito → 100% de acerto
    marks = {1: "C", 2: "A", 3: "D", 4: "B", 5: "A"}
    filled = _make_card(marks)
    r = client.post(
        f"/api/custom-templates/{tid}/test",
        files={"file": ("foto.png", _png_bytes(filled), "image/png")},
        data={"ground_truth": json.dumps({str(k): v for k, v in marks.items()})},
    )
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["success"] is True, res
    assert res["comparison"]["accuracy"] == 1.0
    assert res["rectified_image"].startswith("data:image/")

    # prévia com regiões desenhadas
    r = client.get(f"/api/custom-templates/{tid}/preview?draw=1")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"

    # listar
    r = client.get("/api/custom-templates")
    assert r.status_code == 200
    assert any(t["id"] == tid for t in r.json()["templates"])

    # excluir
    r = client.delete(f"/api/custom-templates/{tid}")
    assert r.status_code == 200 and r.json()["deleted"] == tid


def test_api_activate_blocked_on_errors(authed):
    client = authed
    r = _create(client, _png_bytes(_make_card({})), "Inválido")
    tid = r.json()["id"]
    # config sem questões → erro → ativação bloqueada
    client.put(f"/api/custom-templates/{tid}", json={"config": {"page_w": PAGE_W, "page_h": PAGE_H}})
    r = client.post(f"/api/custom-templates/{tid}/activate")
    assert r.status_code == 400
    assert r.json()["ok"] is False
    client.delete(f"/api/custom-templates/{tid}")


def test_api_persistence_roundtrip(authed, isolated):
    client = authed
    r = _create(client, _png_bytes(_make_card({})), "Persistente")
    tid = r.json()["id"]
    client.put(f"/api/custom-templates/{tid}", json={"config": _config()})
    client.post(f"/api/custom-templates/{tid}/activate")

    # reabre o banco (simula restart) e relê
    isolated.reopen()
    r = client.get(f"/api/custom-templates/{tid}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ativo"
    assert len(body["config"]["questions"]) == 1
    client.delete(f"/api/custom-templates/{tid}")


# ---------------------------------------------------------------------------
# Integração: vínculo com a prova + leitura pelo endpoint de produção
# ---------------------------------------------------------------------------

def test_api_links_exam_and_sets_template(authed, db_session):
    client = authed
    from models import Avaliacao

    r = client.post("/api/exams/sync", json={"external_id": "ex-custom-1", "titulo": "Prova Custom"})
    assert r.status_code == 200, r.text

    r = _create(client, _png_bytes(_make_card({})), "Cartão da prova", avaliacao_external_id="ex-custom-1")
    assert r.status_code == 201, r.text
    tid = r.json()["id"]

    client.put(f"/api/custom-templates/{tid}", json={"config": _config()})
    r = client.post(f"/api/custom-templates/{tid}/activate")
    assert r.status_code == 200, r.text

    db = db_session()
    try:
        av = db.query(Avaliacao).filter(Avaliacao.external_id == "ex-custom-1").one()
        assert av.template == "custom"
        assert av.custom_template_id == tid
    finally:
        db.close()
    client.delete(f"/api/custom-templates/{tid}")


def test_api_process_endpoint_with_custom_template(authed):
    client = authed
    r = _create(client, _png_bytes(_make_card({})), "Leitura custom")
    tid = r.json()["id"]
    client.put(f"/api/custom-templates/{tid}", json={"config": _config()})
    client.post(f"/api/custom-templates/{tid}/activate")

    marks = {1: "C", 2: "A", 3: "D", 4: "B", 5: "A"}
    filled = _make_card(marks)
    r = client.post(
        "/api/omr/process",
        files={"file": ("foto.png", _png_bytes(filled), "image/png")},
        data={"template": "custom", "custom_template_id": str(tid)},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True, body
    assert body["template_used"] == "custom"
    for q, letter in marks.items():
        assert body["answers"][str(q)] == letter

    # sem custom_template_id → erro claro (não cai em outro modelo)
    r = client.post(
        "/api/omr/process",
        files={"file": ("foto.png", _png_bytes(filled), "image/png")},
        data={"template": "custom"},
    )
    assert r.status_code == 200
    assert r.json()["success"] is False

    client.delete(f"/api/custom-templates/{tid}")


# ---------------------------------------------------------------------------
# P1: marca mais escura (pickDarkestMark) + fallback de questão vazia
# ---------------------------------------------------------------------------

def _config_p1(**block_overrides) -> dict:
    cfg = _config()
    cfg["questions"][0].update(block_overrides)
    return cfg


def test_classify_question_darkest_resolves_duplicate():
    from omr.reader import classify_question
    ratios = {"A": 0.50, "B": 0.35, "C": 0.05, "D": 0.04}  # gap 0.15
    assert classify_question(ratios, floor=0.30, margin=0.22)[0] == "duplicate"
    st, letter, marks = classify_question(ratios, floor=0.30, margin=0.22, pick_darkest=True)
    assert st == "darkest" and letter == "A" and marks == ["A"]


def test_classify_question_darkest_requires_gap():
    from omr.reader import classify_question
    ratios = {"A": 0.40, "B": 0.35, "C": 0.05, "D": 0.04}  # gap 0.05 < 0.11 (default)
    assert classify_question(ratios, floor=0.30, margin=0.22, pick_darkest=True)[0] == "duplicate"
    # gap explícito maior ainda exige a diferença
    ratios2 = {"A": 0.50, "B": 0.35, "C": 0.05, "D": 0.04}  # gap 0.15 < 0.20
    assert classify_question(ratios2, floor=0.30, margin=0.22, pick_darkest=True,
                             darkest_gap=0.20)[0] == "duplicate"


def test_classify_question_default_off_unchanged():
    from omr.reader import classify_question
    ratios = {"A": 0.50, "B": 0.35, "C": 0.05, "D": 0.04}
    assert classify_question(ratios, floor=0.30, margin=0.22) == ("duplicate", None, ["A", "B"])
    assert classify_question({"A": 0.9, "B": 0.1}) == ("ok", "A", [])
    assert classify_question({"A": 0.05, "B": 0.04}) == ("blank", None, [])


def test_process_pick_darkest_resolves_two_marks():
    # A preto (0.84) + B cinza 80 (0.69) → dupla com gap ~0.15
    img = _make_card({1: "A"}, gray_marks={(1, "B"): 80})
    base = ct.process_custom_image(img, _config(), strict_alignment=False)
    assert base is not None and 1 in base.duplicate_questions

    res = ct.process_custom_image(img, _config_p1(pick_darkest_mark=True), strict_alignment=False)
    assert res is not None
    assert res.answers.get(1) == "A"
    assert 1 in (res.darkest_marks or [])
    assert res.duplicate_questions == []


def test_process_pick_darkest_keeps_true_duplicate():
    # A e B ambos preto → gap ~0 → continua dupla mesmo com a regra
    img = _make_card({1: "A"})
    nx, ny = _bubble_center(1, "B")
    r_px = int(B_RADIUS * max(PAGE_W, PAGE_H)) - 4
    cv2.circle(img, (int(nx * PAGE_W), int(ny * PAGE_H)), r_px, (0, 0, 0), -1)
    res = ct.process_custom_image(img, _config_p1(pick_darkest_mark=True), strict_alignment=False)
    assert res is not None
    assert 1 in res.duplicate_questions
    assert not (res.darkest_marks or [])


def test_process_pick_darkest_custom_threshold():
    img = _make_card({1: "A"}, gray_marks={(1, "B"): 40})  # gap ~0.076
    low = ct.process_custom_image(
        img, _config_p1(pick_darkest_mark=True, darkest_mark_threshold=0.05),
        strict_alignment=False)
    assert low is not None and low.answers.get(1) == "A"
    high = ct.process_custom_image(
        img, _config_p1(pick_darkest_mark=True, darkest_mark_threshold=0.15),
        strict_alignment=False)
    assert high is not None and 1 in high.duplicate_questions and not (high.darkest_marks or [])


def test_process_pick_darkest_ignored_when_multi_answer():
    # Bloco de múltipla resposta ignora "marca mais escura" e resolve o
    # CONJUNTO de letras marcadas (dentro dos limites) em vez de dupla.
    img = _make_card({1: "A"}, gray_marks={(1, "B"): 80})
    res = ct.process_custom_image(
        img, _config_p1(pick_darkest_mark=True, multi_answer=True), strict_alignment=False)
    assert res is not None
    assert res.answers.get(1) == "AB"
    assert res.multi_marks == {1: ["A", "B"]}
    assert res.duplicate_questions == []


def test_process_fallback_recovers_faint_mark():
    # A cinza 150 → score ~0.21 (abaixo do piso 0.30) mas com vencedor claro
    img = _make_card({}, gray_marks={(1, "A"): 150})
    base = ct.process_custom_image(img, _config(), strict_alignment=False)
    assert base is not None and 1 in base.blank_questions

    res = ct.process_custom_image(img, _config_p1(fallback_on_empty=True), strict_alignment=False)
    assert res is not None
    assert res.answers.get(1) == "A"
    assert 1 in (res.fallback_marks or [])


def test_process_fallback_does_not_invent_on_blank():
    img = _make_card({})
    res = ct.process_custom_image(img, _config_p1(fallback_on_empty=True), strict_alignment=False)
    assert res is not None
    assert 1 in res.blank_questions and not (res.fallback_marks or [])


def test_process_fallback_rejects_two_similar_faint_marks():
    img = _make_card({}, gray_marks={(1, "A"): 150, (1, "B"): 150})
    res = ct.process_custom_image(img, _config_p1(fallback_on_empty=True), strict_alignment=False)
    assert res is not None
    assert 1 in res.blank_questions and not (res.fallback_marks or [])


def test_normalize_and_map_p1_fields():
    cfg = ct.normalize_config(_config_p1(pick_darkest_mark=True, fallback_on_empty=True,
                                         darkest_mark_threshold=0.2, fallback_floor=0.25))
    b = cfg["questions"][0]
    assert b["pick_darkest_mark"] is True and b["fallback_on_empty"] is True
    assert b["darkest_mark_threshold"] == pytest.approx(0.2)
    assert b["fallback_floor"] == pytest.approx(0.25)

    b0 = ct.normalize_config(_config())["questions"][0]
    assert b0["pick_darkest_mark"] is False and b0["darkest_mark_threshold"] is None
    assert b0["fallback_on_empty"] is False and b0["fallback_floor"] is None

    qmap = ct.question_block_map(cfg)
    assert set(qmap) == {1, 2, 3, 4, 5} and qmap[1]["id"] == "blk1"


def test_validate_warns_on_p1_edge_cases():
    issues = ct.validate_config(_config_p1(pick_darkest_mark=True, multi_answer=True,
                                           darkest_mark_threshold=0.0, fallback_floor=0.0))
    codes = {i["code"] for i in issues}
    assert "block_darkest_multi" in codes
    assert "block_darkest_threshold" in codes
    assert "block_fallback_floor" in codes
    assert not ct.has_errors(issues)  # avisos não bloqueiam ativação


def test_api_test_endpoint_reports_p1_marks(authed):
    client = authed
    r = _create(client, _png_bytes(_make_card({})), "Regras P1")
    tid = r.json()["id"]
    client.put(f"/api/custom-templates/{tid}",
               json={"config": _config_p1(pick_darkest_mark=True, fallback_on_empty=True)})

    img = _make_card({1: "A"}, gray_marks={(1, "B"): 80, (2, "A"): 150})
    r = client.post(f"/api/custom-templates/{tid}/test",
                    files={"file": ("foto.png", _png_bytes(img), "image/png")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True, body
    assert body["darkest_marks"] == [1]
    assert body["fallback_marks"] == [2]
    client.delete(f"/api/custom-templates/{tid}")


# ---------------------------------------------------------------------------
# P2: estilo de marcação (mark_style: "filled" | "marks" — check/X)
# ---------------------------------------------------------------------------

def _config_marks(style: str = "marks", **block_overrides) -> dict:
    cfg = _config()
    cfg["questions"][0].update(block_overrides)
    cfg["questions"][0]["mark_style"] = style
    return cfg


def test_mark_coverage_distinguishes_empty_and_x():
    img = np.ones((200, 200), dtype=np.uint8) * 255
    x, y, r = 100, 100, 20
    assert ct._mark_coverage(img, x, y, r) == 0.0
    assert ct.marks_score(img, x, y, r) == 0.0

    cv2.line(img, (x - 12, y - 12), (x + 12, y + 12), 0, 4)
    cv2.line(img, (x + 12, y - 12), (x - 12, y + 12), 0, 4)
    cov = ct._mark_coverage(img, x, y, r)
    assert cov > 0.15
    assert ct.marks_score(img, x, y, r) > 0.6


def test_marks_score_saturates_like_a_clear_mark():
    img = np.ones((200, 200), dtype=np.uint8) * 255
    x, y, r = 100, 100, 20
    cv2.circle(img, (x, y), int(r * 0.72), 0, -1)
    assert ct.marks_score(img, x, y, r) == pytest.approx(1.0)


def _draw_x_at(img: np.ndarray, q: int, letter: str) -> None:
    nx, ny = _bubble_center(q, letter)
    cx, cy = int(nx * PAGE_W), int(ny * PAGE_H)
    r = int(B_RADIUS * max(PAGE_W, PAGE_H)) - 9
    cv2.line(img, (cx - r, cy - r), (cx + r, cy + r), (0, 0, 0), 5)
    cv2.line(img, (cx + r, cy - r), (cx - r, cy + r), (0, 0, 0), 5)


def test_marks_style_reads_x_and_check():
    for drawer in ("x_marks", "check_marks"):
        img = _make_card({}, **{drawer: {1: "A"}})
        res = ct.process_custom_image(img, _config_marks("marks"), strict_alignment=False)
        assert res is not None, drawer
        assert res.answers.get(1) == "A", drawer
        assert 1 not in res.blank_questions, drawer


def test_marks_style_keeps_blank_blank():
    img = _make_card({})
    res = ct.process_custom_image(img, _config_marks("marks"), strict_alignment=False)
    assert res is not None
    assert 1 in res.blank_questions
    assert res.answers == {}
    assert res.all_ratios[1]["A"] == pytest.approx(0.0)


def test_marks_style_reports_duplicate_for_two_marks():
    # Duas X em questões diferentes → ambas lidas
    img = _make_card({}, x_marks={1: "A", 2: "C"})
    res = ct.process_custom_image(img, _config_marks("marks"), strict_alignment=False)
    assert res is not None
    assert res.answers.get(1) == "A" and res.answers.get(2) == "C"
    # Duas X NA MESMA questão → dupla
    img2 = _make_card({})
    _draw_x_at(img2, 1, "A")
    _draw_x_at(img2, 1, "C")
    res2 = ct.process_custom_image(img2, _config_marks("marks"), strict_alignment=False)
    assert res2 is not None and 1 in res2.duplicate_questions


def test_marks_style_reads_filled_mark_too():
    img = _make_card({1: "B"})
    res = ct.process_custom_image(img, _config_marks("marks"), strict_alignment=False)
    assert res is not None and res.answers.get(1) == "B"


def test_marks_style_square_shape():
    img = _make_card({}, x_marks={1: "A"})
    cfg = _config_marks("marks", shape="square")
    res = ct.process_custom_image(img, cfg, strict_alignment=False)
    assert res is not None and res.answers.get(1) == "A"


def test_mark_style_normalize_defaults_to_filled():
    b = ct.normalize_config(_config())["questions"][0]
    assert b["mark_style"] == "filled"
    b2 = ct.normalize_config(_config_marks("marks"))["questions"][0]
    assert b2["mark_style"] == "marks"
    # valor inválido cai no padrão
    cfg = _config()
    cfg["questions"][0]["mark_style"] = "rabisco"
    assert ct.normalize_config(cfg)["questions"][0]["mark_style"] == "filled"


def test_api_test_endpoint_reports_marks_style(authed):
    client = authed
    r = _create(client, _png_bytes(_make_card({})), "Marcas")
    tid = r.json()["id"]
    client.put(f"/api/custom-templates/{tid}", json={"config": _config_marks("marks")})

    img = _make_card({}, x_marks={1: "A"}, check_marks={2: "D"})
    r = client.post(f"/api/custom-templates/{tid}/test",
                    files={"file": ("foto.png", _png_bytes(img), "image/png")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True, body
    assert body["answers"].get("1") == "A" and body["answers"].get("2") == "D"
    client.delete(f"/api/custom-templates/{tid}")


# ---------------------------------------------------------------------------
# Integração com a prova: versionamento, vínculo e LOTE DE IMPRESSÃO
# ---------------------------------------------------------------------------

def test_activate_versions_are_monotonic(authed):
    client = authed
    tid = _create(client, _png_bytes(_make_card({})), "Versionado").json()["id"]
    client.put(f"/api/custom-templates/{tid}", json={"config": _config()})

    r1 = client.post(f"/api/custom-templates/{tid}/activate")
    assert r1.status_code == 200, r1.text
    assert r1.json()["version"] == 1

    # edita o layout e reativa → nova versão imutável (não repete o número)
    cfg = _config()
    cfg["questions"][0]["n_questions"] = 3
    client.put(f"/api/custom-templates/{tid}", json={"config": cfg})
    r2 = client.post(f"/api/custom-templates/{tid}/activate")
    assert r2.status_code == 200, r2.text
    assert r2.json()["version"] == 2
    assert r2.json()["version_id"] != r1.json()["version_id"]

    versions = client.get(f"/api/custom-templates/{tid}/versions").json()["versions"]
    assert [v["version"] for v in versions] == [2, 1]
    # o snapshot da v1 preserva o layout antigo (5 questões), a v2 tem 3
    assert versions[1]["summary"]["n_questions"] == 5
    assert versions[0]["summary"]["n_questions"] == 3
    assert client.get(f"/api/custom-templates/{tid}").json()["version"] == 2
    client.delete(f"/api/custom-templates/{tid}")


def _exam_with_custom_template(client, ext: str, alunos: tuple[str, ...]) -> int:
    client.post("/api/exams/sync", json={"external_id": ext, "titulo": f"Prova {ext}"})
    tid = _create(client, _png_bytes(_make_card({})), f"Cartão {ext}",
                  avaliacao_external_id=ext).json()["id"]
    client.put(f"/api/custom-templates/{tid}", json={"config": _config()})
    assert client.post(f"/api/custom-templates/{tid}/activate").status_code == 200
    return tid


def test_generate_gabaritos_binds_active_version(authed, db_session):
    client = authed
    from models import Aluno, Avaliacao, GabaritoNomeado

    tid = _exam_with_custom_template(client, "ex-custom-ver", ("Ana", "Bia"))
    db = db_session()
    try:
        av = db.query(Avaliacao).filter(Avaliacao.external_id == "ex-custom-ver").one()
        for i, nome in enumerate(("Ana", "Bia"), start=1):
            db.add(Aluno(avaliacao_id=av.id, nome=nome, matricula=f"10{i}"))
        db.commit()
    finally:
        db.close()

    r = client.post("/api/exams/ex-custom-ver/gabaritos/generate")
    assert r.status_code == 200, r.text
    assert r.json()["total_gabaritos"] == 2

    active_vid = client.get(f"/api/custom-templates/{tid}/versions").json()["versions"][0]["id"]
    db = db_session()
    try:
        vids = {g.custom_template_version_id for g in db.query(GabaritoNomeado).all()}
        assert vids == {active_vid}, "cada cartão emitido referencia a versão ativa"
    finally:
        db.close()
    client.delete(f"/api/custom-templates/{tid}")


def test_exam_batch_pdf_uses_custom_template(authed, db_session, monkeypatch):
    """Regressão: o lote da prova deve sair no cartão do MODELO, não no nativo."""
    client = authed
    from models import Aluno, Avaliacao

    tid = _exam_with_custom_template(client, "ex-custom-pdf", ("Ana", "Bia", "Caio"))
    db = db_session()
    try:
        av = db.query(Avaliacao).filter(Avaliacao.external_id == "ex-custom-pdf").one()
        for i, nome in enumerate(("Ana", "Bia", "Caio"), start=1):
            db.add(Aluno(avaliacao_id=av.id, nome=nome, matricula=f"10{i}"))
        db.commit()
    finally:
        db.close()

    assert client.post("/api/exams/ex-custom-pdf/gabaritos/generate").status_code == 200

    calls: dict = {}
    import main
    real = main._custom_batch_pdf

    def spy(db_, av_, gabaritos_, out_):
        calls["n"] = len(gabaritos_)
        return real(db_, av_, gabaritos_, out_)

    monkeypatch.setattr(main, "_custom_batch_pdf", spy)

    r = client.post("/api/exams/ex-custom-pdf/gabaritos/pdf")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert calls.get("n") == 3, "lote deve passar pelo renderizador do modelo personalizado"
    assert len(r.content) > 2000
    client.delete(f"/api/custom-templates/{tid}")


# ---------------------------------------------------------------------------
# P2: múltipla resposta (multi_answer aceita 2+ marcas como CONJUNTO)
# ---------------------------------------------------------------------------

def test_multi_answer_resolves_two_marks_as_set():
    # A sólido + D preto: sem regra é DUPLA; com multi_answer vira conjunto "AD".
    img = _make_card({1: "A"}, gray_marks={(1, "D"): 0})
    base = ct.process_custom_image(img, _config(), strict_alignment=False)
    assert base is not None and 1 in base.duplicate_questions

    res = ct.process_custom_image(img, _config_p1(multi_answer=True), strict_alignment=False)
    assert res is not None
    assert res.answers.get(1) == "AD"
    assert res.multi_marks == {1: ["A", "D"]}
    assert res.duplicate_questions == []


def test_multi_answer_out_of_range_stays_duplicate():
    # Três marcas com máximo 2 → fora do intervalo, continua dupla.
    img = _make_card({1: "A"}, gray_marks={(1, "B"): 0, (1, "D"): 0})
    res = ct.process_custom_image(
        img, _config_p1(multi_answer=True, multi_marks_max=2), strict_alignment=False)
    assert res is not None
    assert 1 in res.duplicate_questions
    assert res.multi_marks == {}


def test_multi_answer_single_letter_not_multi():
    # Uma única marca é resposta normal — não entra como múltipla.
    img = _make_card({1: "A"})
    res = ct.process_custom_image(img, _config_p1(multi_answer=True), strict_alignment=False)
    assert res is not None
    assert res.answers.get(1) == "A"
    assert res.multi_marks == {}


def test_multi_bounds_defaults_to_labels():
    cfg = ct.normalize_config(_config_p1(multi_answer=True))
    b = cfg["questions"][0]
    assert b["multi_marks_min"] is None and b["multi_marks_max"] is None
    assert ct.multi_bounds(b) == (2, 4)  # min default 2, max = nº de alternativas


def test_multi_bounds_normalize_and_clamp():
    cfg = ct.normalize_config(_config_p1(multi_answer=True, multi_marks_min=3,
                                         multi_marks_max=2))
    b = cfg["questions"][0]
    assert b["multi_marks_min"] == 3 and b["multi_marks_max"] == 2
    assert ct.multi_bounds(b) == (3, 3)  # máximo nunca abaixo do mínimo


def test_validate_warns_on_multi_edge_cases():
    issues = ct.validate_config(_config_p1(multi_answer=False, multi_marks_min=1,
                                           multi_marks_max=9))
    codes = {i["code"] for i in issues}
    assert "block_multi_bounds_unused" in codes
    assert "block_multi_min" in codes
    assert "block_multi_max" in codes
    assert not ct.has_errors(issues)

    issues2 = ct.validate_config(_config_p1(multi_answer=True, multi_marks_min=3,
                                            multi_marks_max=2))
    assert "block_multi_range" in {i["code"] for i in issues2}


def test_api_test_endpoint_reports_multi_marks(authed):
    client = authed
    r = _create(client, _png_bytes(_make_card({})), "Múltipla resposta")
    tid = r.json()["id"]
    client.put(f"/api/custom-templates/{tid}",
               json={"config": _config_p1(multi_answer=True)})

    img = _make_card({1: "A"}, gray_marks={(1, "D"): 0})
    r = client.post(f"/api/custom-templates/{tid}/test",
                    files={"file": ("foto.png", _png_bytes(img), "image/png")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True, body
    assert body["multi_marks"] == {"1": ["A", "D"]}
    assert body["answers"]["1"] == "AD"
    assert 1 not in (body["duplicate_questions"] or [])
    client.delete(f"/api/custom-templates/{tid}")


# ---------------------------------------------------------------------------
# Integração prova↔modelo: identidade do cartão personalizado nos endpoints
# ---------------------------------------------------------------------------

def test_exam_endpoints_expose_custom_template_id(authed):
    """A prova precisa chegar ao app marcada como custom (template + id)."""
    client = authed
    tid = _exam_with_custom_template(client, "ex-custom-ident", ("Ana",))

    exams = client.get("/api/exams").json()
    entry = next(e for e in exams if e["external_id"] == "ex-custom-ident")
    assert entry["template"] == "custom"
    assert entry["custom_template_id"] == tid

    detail = client.get("/api/exams/ex-custom-ident").json()
    assert detail["template"] == "custom"
    assert detail["custom_template_id"] == tid
    client.delete(f"/api/custom-templates/{tid}")


def test_exam_without_custom_template_has_null_id(authed):
    client = authed
    client.post("/api/exams/sync", json={"external_id": "ex-native-1", "titulo": "Prova nativa"})
    entry = next(e for e in client.get("/api/exams").json()
                 if e["external_id"] == "ex-native-1")
    assert entry["template"] != "custom"
    assert entry["custom_template_id"] is None
