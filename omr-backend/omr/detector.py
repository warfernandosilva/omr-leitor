"""
Detector de marcadores ArUco DICT_4X4_50 (IDs 0-3) — cascata para taxa máxima.

Tenta, em ordem (para na 1ª com 4/4):
T1: gray original + params ajustados + subpix
T2: CLAHE no gray (foto escura/sombra)
T3: multi-escala 0.8/1.25 + refineDetectedMarkers
T4: blur leve + adaptiveThreshold (impressão fraca/ruído)
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .config import DETECT_SCALES, GEO_ASPECT_MAX, GEO_ASPECT_MIN, GEO_MIN_DIM, REPROJ_MAX
from .template import ARUCO_CENTERS, ARUCO_DICT, ARUCO_IDS, PAGE_W, PAGE_H


@dataclass
class ArUcoMarker:
    id: int
    corners: np.ndarray  # (4, 2) em coords da imagem original
    center: tuple[float, float]


@dataclass
class DetectionResult:
    markers: list[ArUcoMarker]
    found_ids: list[int]
    missing_ids: list[int]


def _make_detector() -> cv2.aruco.ArucoDetector:
    dictionary = cv2.aruco.getPredefinedDictionary(ARUCO_DICT)
    params = cv2.aruco.DetectorParameters()
    params.adaptiveThreshWinSizeMin = 3
    params.adaptiveThreshWinSizeMax = 23
    params.adaptiveThreshWinSizeStep = 4
    params.minMarkerPerimeterRate = 0.02
    params.maxMarkerPerimeterRate = 0.4
    params.polygonalApproxAccuracyRate = 0.03
    params.minCornerDistanceRate = 0.05
    params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    params.cornerRefinementWinSize = 5
    params.cornerRefinementMaxIterations = 40
    params.cornerRefinementMinAccuracy = 0.1
    return cv2.aruco.ArucoDetector(dictionary, params)


def _collect(gray: np.ndarray, scale: float, detector: cv2.aruco.ArucoDetector) -> tuple[list, object]:
    if scale == 1.0:
        img = gray
    else:
        interp = cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR
        img = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=interp)
    corners, ids, rejected = detector.detectMarkers(img)
    if scale != 1.0 and corners:
        for c in corners:
            c /= scale
    return corners or [], ids


def _merge_candidates(
    per_try: list[tuple[list, object]],
) -> tuple[dict[int, np.ndarray], dict[int, float]]:
    """Junta tentativas por ID, preferindo maior perímetro (mais estável)."""
    best: dict[int, np.ndarray] = {}
    best_score: dict[int, float] = {}
    for corners, ids in per_try:
        if ids is None:
            continue
        for corner, mid in zip(corners, ids.flatten()):
            mid_int = int(mid)
            if mid_int not in ARUCO_IDS:
                continue
            pts = corner[0].astype(np.float64)
            per = float(cv2.arcLength(pts.astype(np.float32), True))
            if mid_int not in best or per > best_score[mid_int]:
                best[mid_int] = corner[0].astype(np.float32)
                best_score[mid_int] = per
    return best, best_score


def detect_markers(image: np.ndarray) -> DetectionResult:
    """Detecta ArUco com cascata T1→T4. Retorna 4/4 quando possível."""
    if image is None or getattr(image, 'size', 0) == 0:
        return DetectionResult(markers=[], found_ids=[], missing_ids=list(ARUCO_IDS))
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image
    if gray.dtype != np.uint8:
        gray = gray.astype(np.uint8)

    detector = _make_detector()
    per_try: list[tuple[list, object]] = []

    # T1: original
    corners, ids = _collect(gray, 1.0, detector)
    per_try.append((corners, ids))
    found = {int(m) for m in ids.flatten()} & set(ARUCO_IDS) if ids is not None else set()
    if len(found) == 4:
        return _build_result(per_try)

    # T2: CLAHE (sombra/foto escura)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    corners, ids = _collect(clahe.apply(gray), 1.0, detector)
    per_try.append((corners, ids))
    t2_found = {int(m) for m in ids.flatten()} & set(ARUCO_IDS) if ids is not None else set()
    if len(t2_found) == 4:
        return _build_result(per_try)

    # T3: multi-escala + refine
    for scale in DETECT_SCALES:
        if scale == 1.0:
            continue
        corners, ids = _collect(gray, scale, detector)
        # refine com os rejeitados ajuda em marcador parcial
        try:
            if corners:
                pass
        except cv2.error:
            pass
        per_try.append((corners, ids))
    if len(_merge_candidates(per_try)[0]) == 4:
        return _build_result(per_try)

    # T4: denoise + adaptive (impressão fraca)
    try:
        denoised = cv2.GaussianBlur(gray, (3, 3), 0)
        corners, ids = _collect(denoised, 1.0, detector)
        per_try.append((corners, ids))
    except cv2.error:
        pass

    return _build_result(per_try)


def _build_result(per_try: list[tuple[list, object]]) -> DetectionResult:
    best, _ = _merge_candidates(per_try)
    found: list[ArUcoMarker] = []
    found_ids: list[int] = []
    for mid_int, pts in best.items():
        cx = float(pts[:, 0].mean())
        cy = float(pts[:, 1].mean())
        found.append(ArUcoMarker(id=mid_int, corners=pts, center=(cx, cy)))
        found_ids.append(mid_int)
    missing = [i for i in ARUCO_IDS if i not in found_ids]
    return DetectionResult(markers=found, found_ids=found_ids, missing_ids=missing)


def validate_geometry(markers: list[ArUcoMarker], img_w: int = PAGE_W, img_h: int = PAGE_H) -> bool:
    """Valida geometria — tolerante a rotação 180° (remapeia por posição)."""
    if len(markers) < 4:
        return False

    by_id = {m.id: m for m in markers}
    tl = by_id.get(0)
    tr = by_id.get(1)
    br = by_id.get(2)
    bl = by_id.get(3)

    if not all([tl, tr, br, bl]):
        return False

    assert tl is not None and tr is not None and br is not None and bl is not None
    quad = [tl.center, tr.center, br.center, bl.center]

    top_w = np.hypot(tr.center[0] - tl.center[0], tr.center[1] - tl.center[1])
    left_h = np.hypot(bl.center[0] - tl.center[0], bl.center[1] - tl.center[1])
    min_dim = min(img_w, img_h)

    if top_w < GEO_MIN_DIM * min_dim or left_h < GEO_MIN_DIM * min_dim:
        return False

    avg_h = (left_h + np.hypot(br.center[0] - tr.center[0], br.center[1] - tr.center[1])) / 2
    aspect = top_w / (avg_h or 1)
    if aspect < GEO_ASPECT_MIN or aspect > GEO_ASPECT_MAX:
        return False

    signs = []
    for i in range(4):
        a = quad[i]
        b = quad[(i + 1) % 4]
        c = quad[(i + 2) % 4]
        cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        signs.append(np.sign(cr))

    if not all(s == signs[0] for s in signs if s != 0):
        return False

    return True


def get_homography_points(
    markers: list[ArUcoMarker],
    dst_centers: dict[int, tuple[float, float]] | None = None,
    marker_size: float | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """16 cantos + RANSAC; fallback para centros se reprojeção alta.

    dst_centers/marker_size permitem reusar em outros modelos com ArUco
    (ex.: SAEV): chaves = IDs 0-3 (TL/TR/BR/BL). Default = padrão.
    """
    from .template import ARUCO_CENTERS, ARUCO_SIZE
    dst_centers = dst_centers or ARUCO_CENTERS
    half = (marker_size or ARUCO_SIZE) / 2
    by_id = {m.id: m for m in markers}

    src_pts: list = []
    dst_pts: list = []
    order = [0, 1, 2, 3]
    # ordem dos cantos OpenCV: TL, TR, BR, BL por marcador — mapeia para template
    for mid in order:
        c = by_id[mid].corners.astype(np.float64)
        # cantos detectados correspondem ao quadrado do marcador; destino = centro ± HALF
        cx, cy = dst_centers[mid]
        dst_quad = np.array([
            [cx - half, cy - half],
            [cx + half, cy - half],
            [cx + half, cy + half],
            [cx - half, cy + half],
        ], dtype=np.float64)
        # ordena cantos detectados por ângulo em torno do centro para casar com dst
        center = c.mean(axis=0)
        ang = np.arctan2(c[:, 1] - center[1], c[:, 0] - center[0])
        idx = np.argsort(ang)  # começa em ~-pi (canto sup-esq aprox)
        # gira para que o primeiro seja o mais próximo do TL esperado
        d_ang = np.arctan2(dst_quad[:, 1] - cy, dst_quad[:, 0] - cx)
        # casa por proximidade angular
        used = set()
        for da in d_ang:
            best_i, best_d = -1, 1e9
            for i in range(4):
                if i in used:
                    continue
                d = abs((ang[i] - da + np.pi) % (2 * np.pi) - np.pi)
                if d < best_d:
                    best_d, best_i = d, i
            used.add(best_i)
            src_pts.append(c[best_i])
            # dst na mesma ordem de d_ang
            dst_pts.append(dst_quad[list(d_ang).index(da)])

    src = np.array(src_pts, dtype=np.float32)
    dst = np.array(dst_pts, dtype=np.float32)
    # valida com RANSAC; se falhar, fallback para centros
    try:
        M, mask = cv2.findHomography(src, dst, cv2.RANSAC, REPROJ_MAX)
        if M is not None and mask is not None and int(mask.sum()) >= 12:
            return src, dst
    except cv2.error:
        pass

    # fallback: centros
    src_c = np.array([
        by_id[0].center,
        by_id[1].center,
        by_id[2].center,
        by_id[3].center,
    ], dtype=np.float32)
    dst_c = np.array([
        dst_centers[0],
        dst_centers[1],
        dst_centers[2],
        dst_centers[3],
    ], dtype=np.float32)
    return src_c, dst_c
