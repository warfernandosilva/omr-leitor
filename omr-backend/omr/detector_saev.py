"""Âncoras do modelo SAEV: ArUco DICT_4X4_50 (IDs 0-3), 104px.

Adaptador fino sobre o detector padrão: mesma cascata T1–T4 (7/7),
cantos com ID e homografia de 16 cantos + RANSAC. Os cartões SAEV
antigos (quadrados pretos) deixaram de ser suportados — reimprimir.
"""

from __future__ import annotations

import cv2
import numpy as np

from .detector import (
    ArUcoMarker,
    detect_markers,
    get_homography_points,
    validate_geometry,
)
from .detector_sae import CORNERS_ORDER, SaeDetectionResult
from .template_saev import SAEV_ARUCO_DST, SAEV_CORNER_CENTERS, PAGE_W, PAGE_H

_ID_TO_CORNER = {0: "TL", 1: "TR", 2: "BR", 3: "BL"}


def detect_saev_corners(image: np.ndarray) -> SaeDetectionResult:
    """Detecta os 4 ArUco SAEV. Retorna centros ordenados TL/TR/BR/BL."""
    det = detect_markers(image)
    centers: dict[str, tuple[float, float]] = {}
    for m in det.markers:
        corner = _ID_TO_CORNER.get(m.id)
        if corner:
            centers[corner] = m.center
    missing = [k for k in CORNERS_ORDER if k not in centers]
    found = not missing and validate_geometry(det.markers)
    markers = [m for m in det.markers if m.id in _ID_TO_CORNER]
    return SaeDetectionResult(centers=centers, found=bool(found), missing=missing, markers=markers)


def saev_homography_aruco(markers: list[ArUcoMarker]) -> tuple[np.ndarray, np.ndarray] | None:
    """Pontos src/dst (16 cantos + RANSAC dentro) p/ a homografia SAEV."""
    try:
        return get_homography_points(markers, SAEV_ARUCO_DST)
    except (KeyError, IndexError):
        return None


def saev_homography(centers: dict[str, tuple[float, float]]) -> np.ndarray | None:
    """Fallback legado: 4 centros -> getPerspectiveTransform (sem RANSAC)."""
    try:
        src = np.array([centers[k] for k in CORNERS_ORDER], dtype=np.float32)
        dst = np.array([SAEV_CORNER_CENTERS[k] for k in CORNERS_ORDER], dtype=np.float32)
    except KeyError:
        return None
    try:
        return cv2.getPerspectiveTransform(src, dst)
    except cv2.error:
        return None


__all__ = [
    "detect_saev_corners",
    "saev_homography",
    "saev_homography_aruco",
    "PAGE_W",
    "PAGE_H",
]
