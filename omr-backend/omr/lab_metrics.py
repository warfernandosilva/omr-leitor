"""Métricas e calibração do Laboratório OMR (funções puras, sem DB).

O heart da calibração: como cada bolha tem seus COMPONENTES de score
salvos (LabOptionScore), dá para RECLASSIFICAR todas as questões com novos
floor/margin/pesos SEM reler a imagem (barato) e medir a acurácia contra
o gabarito. Só pesos/CLAHE/raio mudam o score em si — aí precisa
reprocessar (Fase 2, endpoint de reprocessamento com overrides).

Confiança (gap): best - second (maior é melhor). É a métrica de confiança
padrão; pode ser sobreposta por outro score no futuro.

Fase B: persistência de componentes em data/lab/<n>/components.json.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from itertools import product
from pathlib import Path
from typing import Any

from .reader import classify_question

STATUS_OK = "ok"
STATUS_LOW = "low"
STATUS_DUPLICATE = "duplicate"
STATUS_BLANK = "blank"


def confidence_gap(ratios: dict[str, float]) -> float:
    """Gap 1º-2º (maior = mais convincente). É a confiança padrão."""
    ordered = sorted(ratios.values(), reverse=True)
    return ordered[0] - (ordered[1] if len(ordered) > 1 else 0.0)


@dataclass
class OptionComponents:
    """Componentes salvos de uma bolha (permite rescore sem reler a foto)."""
    letter: str
    mean_intensity: float
    dark_ratio: float
    contrast: float
    otsu_threshold: float

    def score(self, weights: tuple[float, float, float] | None = None) -> float:
        w = weights or (0.4, 0.4, 0.2)
        return w[0] * self.mean_intensity + w[1] * self.dark_ratio + w[2] * self.contrast


def rescored_ratios(
    comps: list[OptionComponents], weights: tuple[float, float, float] | None
) -> dict[str, float]:
    return {c.letter: c.score(weights) for c in comps}


def reclassify_question(
    comps: list[OptionComponents],
    floor: float,
    margin: float,
    weights: tuple[float, float, float] | None = None,
    low_conf_threshold: float | None = None,
) -> tuple[str, str | None, list[str], float]:
    """Reclassifica uma questão a partir dos componentes salvos.

    Devolve (status, melhor_letra, marcas, confiança_gap) usando exatamente
    a MESMA regra de reader.classify_question (com overrides opcionais).
    """
    ratios = rescored_ratios(comps, weights)
    status, letter, marks = classify_question(
        ratios, floor=floor, margin=margin, low_thr=low_conf_threshold
    )
    return status, letter, marks, confidence_gap(ratios)


def compute_metrics(per_question: list[dict]) -> dict:
    """Métricas consolidadas a partir de uma lista de questões.

    Cada item: {status, truth (str|None), detected (str|None)}.
    Regras:
    - só entram no denominador COM gabarito (truth preenchida);
    - blank conta como errada (a folha não marcou o que devia);
    - AMBIGUA (low + duplicate) NÃO conta como acerto nem erro — fica
      fora do denominador até conferência manual (decisão do produto).
    """
    com_gabarito = [q for q in per_question if q.get("truth")]
    total_com_truth = len(com_gabarito)

    acertos = 0
    erros = 0
    brancos = 0
    ambiguas = 0
    for q in com_gabarito:
        status = q["status"]
        truth = q["truth"]
        detected = q.get("detected")
        if status == STATUS_OK:
            if detected == truth:
                acertos += 1
            else:
                erros += 1
        elif status == STATUS_BLANK:
            brancos += 1
            erros += 1  # não marcou o gabarito = erro
        elif status in (STATUS_LOW, STATUS_DUPLICATE):
            ambiguas += 1
        else:  # status inesperado — trata como erro (safety)
            erros += 1

    answered = acertos + erros  # denominador de acurácia (AMBIGUA fora)
    return {
        "total_questoes": len(per_question),
        "com_gabarito": total_com_truth,
        "acertos": acertos,
        "erros": erros,
        "brancos": brancos,
        "ambiguas": ambiguas,
        "respondidas": answered,
        "taxa_acerto": (acertos / answered) if answered else None,
        "taxa_erro": (erros / answered) if answered else None,
        "taxa_branco": (brancos / total_com_truth) if total_com_truth else None,
        "taxa_ambigua": (ambiguas / total_com_truth) if total_com_truth else None,
    }


def grid_search(
    questions_with_comps: list[dict],
    floor_grid: list[float],
    margin_grid: list[float],
    weights_grid: list[tuple[float, float, float]] | None = None,
    low_conf_threshold: float | None = None,
    truth_key: str = "truth",
    comps_key: str = "comps",
) -> list[dict]:
    """Varre (floor × margin × pesos) e devolve candidatos ordenados.

    Só conta com questões que têm gabarito. Cada item de
    `questions_with_comps`: {truth: str|None, comps: list[OptionComponents]}.
    Ordena por: taxa_acerto desc, ambiguas asc (desempate estável).
    """
    w_grid = weights_grid or [(0.4, 0.4, 0.2)]
    results: list[dict] = []
    for floor, margin, weights in product(floor_grid, margin_grid, w_grid):
        per_q = []
        for item in questions_with_comps:
            comps = item[comps_key]
            if not comps:
                continue
            status, letter, _marks, _gap = reclassify_question(
                comps, floor, margin, weights, low_conf_threshold
            )
            per_q.append({
                "status": status,
                "truth": item.get(truth_key),
                "detected": letter,
            })
        m = compute_metrics(per_q)
        results.append({
            "floor": floor,
            "margin": margin,
            "weights": list(weights),
            "low_conf_threshold": low_conf_threshold,
            **{k: m[k] for k in (
                "total_questoes", "com_gabarito", "acertos", "erros",
                "brancos", "ambiguas", "respondidas", "taxa_acerto",
                "taxa_erro", "taxa_branco", "taxa_ambigua",
            )},
        })
    results.sort(key=lambda r: (
        -(r["taxa_acerto"] if r["taxa_acerto"] is not None else -1),
        r["ambiguas"],
        -(r["acertos"]),
    ))
    return results


def best_candidate(results: list[dict]) -> dict | None:
    return results[0] if results else None


def save_components_json(session_id: int, questions_with_comps: list[dict], lab_root: Path | None = None) -> Path:
    """Persiste componentes de score em data/lab/<session_id>/components.json.

    `questions_with_comps`: lista de dicts com chaves:
    - question_number: int
    - options: list[OptionComponents]
    - truth: str|None (opcional)
    - image_id: int (opcional)

    Retorna o Path do arquivo salvo.
    """
    if lab_root is None:
        lab_root = Path(__file__).resolve().parent.parent / "data" / "lab"

    session_dir = lab_root / str(session_id)
    session_dir.mkdir(parents=True, exist_ok=True)

    payload = {
        "session_id": session_id,
        "saved_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "questions": [
            {
                "question_number": q["question_number"],
                "truth": q.get("truth"),
                "image_id": q.get("image_id"),
                "options": [asdict(c) for c in q["options"]],
            }
            for q in questions_with_comps
        ],
    }

    out_path = session_dir / "components.json"
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return out_path


def load_components_json(session_id: int, lab_root: Path | None = None) -> list[dict]:
    """Carrega componentes salvos de data/lab/<session_id>/components.json.

    Retorna lista de dicts com as mesmas chaves de save_components_json.
    Se arquivo não existir, retorna lista vazia.
    """
    if lab_root is None:
        lab_root = Path(__file__).resolve().parent.parent / "data" / "lab"

    path = lab_root / str(session_id) / "components.json"
    if not path.exists():
        return []

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        questions = []
        for q in data.get("questions", []):
            questions.append({
                "question_number": q["question_number"],
                "truth": q.get("truth"),
                "image_id": q.get("image_id"),
                "options": [
                    OptionComponents(
                        letter=o["letter"],
                        mean_intensity=o["mean_intensity"],
                        dark_ratio=o["dark_ratio"],
                        contrast=o["contrast"],
                        otsu_threshold=o["otsu_threshold"],
                    )
                    for o in q.get("options", [])
                ],
            })
        return questions
    except (OSError, ValueError, KeyError):
        return []