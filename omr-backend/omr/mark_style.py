"""Classificação do ESTILO da marca de uma bolha.

Portado do amazingOMR (`mark_style.py`). Responde "como a bolha foi
marcada?" — preenchida, traço (tick), X, círculo, borracha/apagada ou
vazia — a partir de sete medidas da ROI. Serve para explicar ao revisor
por que uma marca foi considerada ambígua (e para detectar apagamento).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

MARK_STYLES = ("fill", "tick", "cross", "circle", "erasure_ghost", "blank")

_HARD_INK = 0.55
_STROKE_INK = 0.40
_SOFT_INK = 0.12
_INNER_FRAC = 0.72
_CORE_FRAC = 0.32
_RING_OUTER = 1.05


@dataclass
class MarkStats:
    darkness: float
    hard_fill: float
    soft_cover: float
    center_fill: float
    ring_fill: float
    uniformity: float
    symmetry: float

    def to_dict(self) -> dict:
        return {k: round(float(v), 4) for k, v in self.__dict__.items()}


def _region_masks(shape: tuple[int, int], cx: float, cy: float,
                  r_px: float):
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    dist2 = (xx - cx) ** 2 + (yy - cy) ** 2
    inner = dist2 <= (r_px * _INNER_FRAC) ** 2
    core = dist2 <= (r_px * _CORE_FRAC) ** 2
    ring = ((dist2 > (r_px * _INNER_FRAC) ** 2)
            & (dist2 <= (r_px * _RING_OUTER) ** 2))
    return inner, core, ring, xx, yy


def mark_stats(patch: np.ndarray, paper: float, ink: float, r_px: float,
               center: tuple[float, float] | None = None) -> MarkStats:
    if patch.ndim != 2:
        raise ValueError("mark_stats espera um patch de 1 canal")
    h, w = patch.shape
    if center is None:
        cx, cy = (w - 1) / 2.0, (h - 1) / 2.0
    else:
        cx, cy = center

    inner, core, ring, xx, yy = _region_masks(patch.shape, cx, cy, r_px)
    if not inner.any():
        return MarkStats(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

    span = max(paper - ink, 1.0)
    dark = np.clip((paper - patch.astype(np.float32)) / span, 0.0, 1.0)

    d_inner = dark[inner]
    darkness = float(d_inner.mean())
    hard_fill = float((d_inner >= _HARD_INK).mean())
    soft_cover = float((d_inner >= _SOFT_INK).mean())
    center_fill = float((dark[core] >= _HARD_INK).mean()) if core.any() else 0.0
    ring_fill = float((dark[ring] >= _HARD_INK).mean()) if ring.any() else 0.0

    lit = d_inner[d_inner >= _SOFT_INK]
    if lit.size >= 4 and lit.mean() > 1e-6:
        cov = float(lit.std() / lit.mean())
        uniformity = float(np.clip(1.0 - cov, 0.0, 1.0))
    else:
        uniformity = 0.0

    stroke = (dark >= _STROKE_INK) & inner
    left, top = xx < cx, yy < cy
    quad = np.array([
        int((stroke & top & left).sum()),
        int((stroke & top & ~left).sum()),
        int((stroke & ~top & left).sum()),
        int((stroke & ~top & ~left).sum()),
    ], dtype=np.float64)
    symmetry = float(quad.min() / quad.max()) if quad.max() > 0 else 0.0

    return MarkStats(darkness, hard_fill, soft_cover, center_fill,
                     ring_fill, uniformity, symmetry)


def classify(stats: MarkStats) -> str:
    """Rótulo do estilo a partir das medidas da ROI."""
    s = stats
    if (s.hard_fill < 0.06 and s.soft_cover < 0.15 and s.darkness < 0.10
            and s.ring_fill < 0.15):
        return "blank"

    if s.hard_fill >= 0.55 and s.center_fill >= 0.5:
        # Um X grosso também cobre o centro. Diferencie pelo anel: o traço
        # cobre só as diagonais, enquanto o preenchimento cobre o anel todo.
        if s.ring_fill < 0.6 * s.hard_fill and s.uniformity < 0.9:
            return "cross"
        return "fill"

    if (s.ring_fill >= 0.22 and s.center_fill < 0.15
            and s.hard_fill < 0.40 and s.ring_fill >= s.hard_fill):
        return "circle"

    if (s.hard_fill < 0.18 and s.soft_cover >= 0.55
            and 0.15 <= s.darkness <= 0.48 and s.uniformity >= 0.5):
        return "erasure_ghost"

    if s.hard_fill >= 0.05 or s.center_fill >= 0.2:
        if s.symmetry >= 0.4 and s.center_fill >= 0.25:
            return "cross"
        return "tick"

    if 0.12 <= s.darkness <= 0.5:
        return "erasure_ghost"
    return "blank"


def classify_patch(patch: np.ndarray, paper: float, ink: float, r_px: float,
                   center: tuple[float, float] | None = None) -> str:
    return classify(mark_stats(patch, paper, ink, r_px, center))


def classify_bubble(gray: np.ndarray, x: float, y: float, r_px: float,
                    paper: float, ink: float) -> str:
    """Classifica a bolha centrada em `(x, y)` (pixels da imagem retificada)."""
    pad = int(round(r_px * _RING_OUTER + 3))
    x0, y0 = int(round(x - pad)), int(round(y - pad))
    x1, y1 = int(round(x + pad)), int(round(y + pad))
    h, w = gray.shape[:2]
    x0c, y0c = max(0, x0), max(0, y0)
    patch = gray[y0c:min(h, y1), x0c:min(w, x1)]
    if patch.size == 0:
        return ""
    return classify_patch(patch, paper, ink, r_px,
                          center=(x - x0c, y - y0c))
