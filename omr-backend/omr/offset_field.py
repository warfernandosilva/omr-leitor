"""Offset field — correção de curl/amassado depois do warp plano.

Portado do amazingOMR (`bubbles.OffsetField` / `estimate_offset_field`).

O warp por homografia corrige a perspectiva da FOLHA, mas não o relevo
local: uma folha enrolada ou amassada faz cada bolha cair alguns pixels
fora do lugar previsto. O offset field estima um campo de deslocamento
suave (polinômio de 2º grau ajustado por ILRS — mínimos quadrados com
pesos robustos) a partir de template matching de um ANEL no contorno das
bolhas vazias.

Se o ajuste não fecha (RMS > 4 px), cai para um deslocamento constante
(mediana) — nunca piora o alinhamento por causa de outliers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

import cv2
import numpy as np

# Raios de busca do anel (px). Tenta o maior primeiro (mais contexto) e
# afrouxa para o menor quando poucas bolhas casam.
SNAP_RADIUSES = (28, 10, 7)
MIN_SAMPLES = 12
MAX_RMS_PX = 4.0
MIN_MATCH = 0.15


def _ring_template(r_px: float) -> np.ndarray:
    r_px = max(float(r_px), 0.5)
    size = int(round(r_px * 2 + 8)) | 1
    tmpl = np.zeros((size, size), dtype=np.uint8)
    c = size // 2
    cv2.circle(tmpl, (c, c), int(round(r_px)), 255, 2, cv2.LINE_AA)
    return tmpl


@dataclass(frozen=True)
class OffsetField:
    """Campo (dx, dy) = P(xn, yn) com base polinomial de 2º grau."""

    cx: tuple[float, ...]
    cy: tuple[float, ...]
    w: float = 1.0
    h: float = 1.0

    @staticmethod
    def _basis(xn: np.ndarray, yn: np.ndarray) -> np.ndarray:
        one = np.ones_like(xn)
        return np.stack([one, xn, yn, xn * xn, xn * yn, yn * yn], axis=-1)

    def __call__(self, x_px: float, y_px: float) -> tuple[float, float]:
        b = self._basis(
            np.float64(x_px) / max(self.w, 1.0),
            np.float64(y_px) / max(self.h, 1.0),
        )
        return float(b @ np.asarray(self.cx)), float(b @ np.asarray(self.cy))

    @classmethod
    def constant(cls, dx: float = 0.0, dy: float = 0.0) -> "OffsetField":
        return cls((dx, 0.0, 0.0, 0.0, 0.0, 0.0),
                   (dy, 0.0, 0.0, 0.0, 0.0, 0.0), 1.0, 1.0)

    @classmethod
    def fit(cls, samples: Sequence[tuple[float, float, float, float]],
            w: float, h: float) -> "OffsetField":
        """Ajusta o polinômio a amostras (x, y, dx, dy) por ILRS."""
        arr = np.asarray(list(samples), dtype=np.float64)
        if len(arr) < MIN_SAMPLES:
            if len(arr) == 0:
                return cls.constant(0.0, 0.0)
            return cls.constant(float(np.median(arr[:, 2])),
                                float(np.median(arr[:, 3])))

        xn, yn = arr[:, 0] / max(w, 1.0), arr[:, 1] / max(h, 1.0)
        basis = cls._basis(xn, yn)
        weights = np.ones(len(arr))
        cx = np.zeros(6)
        cy = np.zeros(6)

        for _ in range(3):
            wb = basis * weights[:, None]
            cx, *_ = np.linalg.lstsq(wb, arr[:, 2] * weights, rcond=None)
            cy, *_ = np.linalg.lstsq(wb, arr[:, 3] * weights, rcond=None)
            res = np.hypot(basis @ cx - arr[:, 2], basis @ cy - arr[:, 3])
            weights = np.minimum(1.0, 3.0 / np.maximum(res, 1e-6))

        inlier = weights > 0.5
        if inlier.sum() >= 8:
            res = np.hypot(
                basis[inlier] @ cx - arr[inlier, 2],
                basis[inlier] @ cy - arr[inlier, 3],
            )
            if float(np.sqrt(np.mean(res ** 2))) > MAX_RMS_PX:
                return cls.constant(float(np.median(arr[inlier, 2])),
                                    float(np.median(arr[inlier, 3])))
        return cls(tuple(float(v) for v in cx), tuple(float(v) for v in cy),
                   max(float(w), 1.0), max(float(h), 1.0))


def _snap_offset(inv: np.ndarray, x_px: float, y_px: float, r_px: float,
                 predict: tuple[float, float],
                 radius: int) -> tuple[float, float] | None:
    """Posição real do anel da bolha em relação à posição prevista."""
    tmpl = _ring_template(r_px)
    th, tw = tmpl.shape
    cx = x_px + predict[0]
    cy = y_px + predict[1]
    x0 = int(round(cx - tw / 2 - radius))
    y0 = int(round(cy - th / 2 - radius))
    x1, y1 = x0 + tw + 2 * radius, y0 + th + 2 * radius
    if x0 < 0 or y0 < 0 or y1 > inv.shape[0] or x1 > inv.shape[1]:
        return None
    res = cv2.matchTemplate(inv[y0:y1, x0:x1], tmpl, cv2.TM_CCOEFF_NORMED)
    _, maxv, _, maxloc = cv2.minMaxLoc(res)
    if maxv < MIN_MATCH:
        return None
    return ((x0 + maxloc[0] + tw / 2) - x_px,
            (y0 + maxloc[1] + th / 2) - y_px)


def estimate_offset_field(
    gray: np.ndarray,
    cells: Iterable[tuple[float, float, float]],
) -> OffsetField:
    """Estima o campo a partir de células `(cx, cy, r)` em pixels."""
    cells = list(cells)
    if not cells:
        return OffsetField.constant(0.0, 0.0)
    gray = np.ascontiguousarray(gray)
    h, w = gray.shape[:2]
    inv = 255 - gray
    step = max(1, len(cells) // 110)
    sampled = cells[::step]

    field = OffsetField.constant(0.0, 0.0)
    best_n = 0
    for radius in SNAP_RADIUSES:
        samples: list[tuple[float, float, float, float]] = []
        for x_px, y_px, r_px in sampled:
            off = _snap_offset(inv, float(x_px), float(y_px), float(r_px),
                               field(float(x_px), float(y_px)), radius)
            if off is not None:
                samples.append((float(x_px), float(y_px), *off))
        if len(samples) >= max(MIN_SAMPLES, int(best_n * 0.7)):
            field = OffsetField.fit(samples, w, h)
            best_n = max(best_n, len(samples))
    return field


def estimate_global_offset(
    gray: np.ndarray,
    cells: Iterable[tuple[float, float, float]],
) -> tuple[float, float]:
    """Deslocamento no centro da imagem (atalho para um offset só)."""
    field = estimate_offset_field(gray, cells)
    h, w = gray.shape[:2]
    return field(w / 2.0, h / 2.0)
