"""Imagens de diagnóstico (flag debug): heatmap de scores por bolha.

Só calculado quando pedido (default off = zero custo). Cada ponto carrega
(x, y, raio, score, verdict) em coords do template; o render pinta o
preenchimento pela cor do score e o contorno pela verdict.
"""
import base64

import cv2
import numpy as np

# verdict -> cor BGR do contorno
VERDICT_COLOR = {
    "ok": (22, 163, 74),
    "low": (245, 158, 11),
    "dup": (249, 115, 22),
    "blank": (148, 163, 184),
}


def score_color(score: float) -> tuple[int, int, int]:
    """Verde (marcada) -> amarelo -> vermelho (vazia), BGR."""
    s = max(0.0, min(1.0, score * 2.0))  # 0.5+ = verde cheio
    r = int(220 * (1.0 - s))
    g = int(200 * s)
    return (40, g, r)


def build_debug_points(
    geom: dict[int, list[tuple[float, float, float, str]]],
    all_ratios: dict[int, dict[str, float]],
    answers: dict[int, str],
    blank: list[int],
    duplicates: list[int],
    low_conf: list[int],
) -> list[dict]:
    """Junta geometria + scores + verdict por bolha (JSON-safe)."""
    out: list[dict] = []
    for q, cells in geom.items():
        if q in duplicates:
            verdict = "dup"
        elif q in blank:
            verdict = "blank"
        elif q in low_conf:
            verdict = "low"
        elif q in answers:
            verdict = "ok"
        else:
            verdict = "blank"
        ratios = all_ratios.get(q, {})
        for x, y, r, letter in cells:
            out.append({
                "x": round(float(x), 1), "y": round(float(y), 1),
                "r": round(float(r), 1), "letter": letter,
                "score": round(float(ratios.get(letter, 0.0)), 3),
                "verdict": verdict,
            })
    return out


def render_heatmap(rectified_bgr: np.ndarray, points: list[dict], max_side: int = 720) -> str | None:
    """Desenha o heatmap sobre a retificada e devolve dataURL JPEG (ou None)."""
    try:
        h, w = rectified_bgr.shape[:2]
        scale = min(1.0, max_side / max(h, w))
        img = rectified_bgr if scale >= 1.0 else cv2.resize(
            rectified_bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        for p in points:
            x, y = int(p["x"] * scale), int(p["y"] * scale)
            r = max(3, int(p["r"] * scale))
            cv2.circle(img, (x, y), r, score_color(p.get("score", 0.0)), -1)
            cv2.circle(img, (x, y), r, VERDICT_COLOR.get(p.get("verdict", "blank"), (148, 163, 184)), 2)
        _, buf = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        return f"data:image/jpeg;base64,{base64.b64encode(buf.tobytes()).decode('ascii')}"
    except Exception:
        return None
