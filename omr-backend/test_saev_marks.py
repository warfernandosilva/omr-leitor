"""Marcas intencionais SAEV: dupla, branca e fraca (sintético estrito + fotos B).

Ground-truth visual do cartão B (caneta azul):
LP: 1A,2B,9AD-dupla,11B, resto branco | MAT: 1A,2B,3C,4A,5C,6BC-dupla,7D,8B,
9B,11A,12B,13D,19A,20D,21B+X,22A, resto branco.
"""

import os

import cv2
import numpy as np

from omr.template_saev import (
    SaevSpec, generate_saev_card, saev_block_rows, saev_bubble_center,
    SAEV_SIDE,
)
from omr.reader_saev import process_saev_image

QPS = 22
CAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "calibration")
LETTERS = ["A", "B", "C", "D"]


def _fill(out, qps, q, letter, frac=1.0):
    for qq, col, r in saev_block_rows(qps):
        if qq != q:
            continue
        cx, cy = saev_bubble_center(col, r, LETTERS.index(letter), qps)
        cx, cy = int(cx), int(cy)
        half = int(SAEV_SIDE / 2 - 6 * frac)
        cv2.rectangle(out, (cx - half, cy - half), (cx + half, cy + half),
                      (20, 20, 20), -1)
        return
    raise AssertionError(f"Q{q} fora da grade")


def _photo(name):
    p = os.path.join(CAL, name)
    if not os.path.exists(p):
        return None
    return cv2.imread(p)


def test_classify_unidade():
    from omr.reader import classify_question
    assert classify_question({"A": 0.9, "B": 0.1, "C": 0.08, "D": 0.05})[0] == "ok"
    assert classify_question({"A": 0.1, "B": 0.08, "C": 0.05, "D": 0.04})[0] == "blank"
    st, _, marks = classify_question({"A": 0.85, "B": 0.1, "C": 0.08, "D": 0.8})
    assert st == "duplicate" and set(marks) == {"A", "D"}, (st, marks)
    assert classify_question({"A": 0.35, "B": 0.33, "C": 0.1, "D": 0.05})[0] in ("low", "duplicate", "blank")


def _synthetic(qps=QPS):
    base = generate_saev_card(SaevSpec(n_questoes=qps), student_name="TESTE",
                              qr_override="OMR-2026-000099")
    img = base.copy()
    _fill(img, qps, 1, "A")          # simples forte
    _fill(img, qps, 2, "B")          # dupla intencional B+D
    _fill(img, qps, 2, "D")
    # Q3 fica em branco intencional
    weak = img.copy()                # marca fraca: só miolo 10x10
    for qq, col, r in saev_block_rows(qps):
        if qq != 4:
            continue
        cx, cy = saev_bubble_center(col, r, 2, qps)
        cx, cy = int(cx), int(cy)
        cv2.rectangle(weak, (cx - 5, cy - 5), (cx + 5, cy + 5), (20, 20, 20), -1)
    return img, weak


def test_sintetico_dupla_branca():
    img, _ = _synthetic()
    res = process_saev_image(img, questions_per_subject=QPS)
    assert res is not None
    assert res.answers.get(1) == "A", res.answers.get(1)
    assert 2 in res.duplicate_questions, res.duplicate_questions[:5]
    assert set((res.duplicate_marks or {}).get(2, [])) == {"B", "D"}
    assert 3 in res.blank_questions, res.blank_questions[:5]
    assert res.qr_id == "OMR-2026-000099", res.qr_id


def test_sintetico_fraca_nao_vira_dupla():
    _, weak = _synthetic()
    res = process_saev_image(weak, questions_per_subject=QPS)
    assert res is not None
    assert 4 not in res.duplicate_questions  # fraca nunca é dupla


def test_sintetico_perspectiva():
    img, _ = _synthetic()
    h, w = img.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[15, 25], [w - 20, 10], [w - 12, h - 18], [12, h - 12]])
    M = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(img, M, (w, h), borderValue=(255, 255, 255))
    res = process_saev_image(warped, questions_per_subject=QPS)
    assert res is not None
    assert res.answers.get(1) == "A"
    assert 2 in res.duplicate_questions
    assert 3 in res.blank_questions


# Marcas do cartão B (foto real) — 44 questões conferidas
MARKS_B_LP = {1: "A", 2: "B", 9: "AD", 11: "B"}
MARKS_B_MAT = {1: "A", 2: "B", 3: "C", 4: "A", 5: "C", 6: "BC", 7: "D", 8: "B",
               9: "B", 11: "A", 12: "B", 13: "D", 19: "A", 20: "D", 21: "BX", 22: "A"}


def _score_marks(res, tag):
    hit, tot, bad = 0, 0, []
    for q in range(1, 45):
        e = MARKS_B_LP.get(q) if q <= 22 else MARKS_B_MAT.get(q - 22)
        e = e or ""
        tot += 1
        if e in ("AD", "BC"):
            got = set((res.duplicate_marks or {}).get(q, []))
            if q in res.duplicate_questions and set(e) <= got:
                hit += 1
            else:
                bad.append(f"Q{q} dup{e}/{got}")
        elif e == "":
            if q in res.blank_questions:
                hit += 1
            else:
                bad.append(f"Q{q} blank/{res.answers.get(q)}")
        elif e == "BX":
            if res.answers.get(q) == "B" and q not in res.duplicate_questions:
                hit += 1
            else:
                bad.append(f"Q{q} BX/{res.answers.get(q)}")
        else:
            if res.answers.get(q) == e and q not in res.duplicate_questions \
                    and q not in res.low_confidence:
                hit += 1
            else:
                bad.append(f"Q{q} {e}/{res.answers.get(q)}")
    return hit, tot, bad


def test_fotos_b_precisao():
    # Fotos do cartão ANTIGO (âncoras = quadrados pretos): desde a troca por
    # ArUco, o leitor rejeita (None) — documenta a quebra + orienta reimprimir.
    # Quando chegarem fotos do NOVO layout, reativar os asserts de precisão.
    for name in ["novo (2).jpeg", "novo (5).jpeg", "novo (7).jpeg", "novo (10).jpeg"]:
        img = _photo(name)
        if img is None:
            print(f"SKIP {name}: sem foto"); continue
        res = process_saev_image(img, questions_per_subject=22, adaptive=True)
        assert res is None, f"{name}: cartão antigo ainda lendo (esperado: None/reimprimir)"
        print(f"{name}: rejeitado como esperado (layout antigo)")


def test_fotos_deteccao_e_qr():
    # Idem: fotos antigas devem ser rejeitadas, não lidas.
    for name in ["novo (1).jpeg", "novo (4).jpeg", "novo (9).jpeg",
                 "gabi preenchido (2).jpeg"]:
        img = _photo(name)
        if img is None:
            print(f"SKIP {name}: sem foto"); continue
        res = process_saev_image(img, questions_per_subject=22, adaptive=True)
        assert res is None, f"{name}: cartão antigo ainda lendo (esperado: None/reimprimir)"
        print(f"{name}: rejeitado como esperado (layout antigo)")


def main() -> None:
    test_classify_unidade(); print("unit classify: OK")
    test_sintetico_dupla_branca(); print("sintetico dupla/branca: OK")
    test_sintetico_fraca_nao_vira_dupla(); print("sintetico fraca: OK")
    test_sintetico_perspectiva(); print("sintetico perspectiva: OK")
    test_fotos_b_precisao()
    test_fotos_deteccao_e_qr()
    print("E2E SAEV-MARKS: PASS")


if __name__ == "__main__":
    main()
