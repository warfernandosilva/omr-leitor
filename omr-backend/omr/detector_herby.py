"""Âncoras do modelo Herby: 2 QR Codes + bordas da página — SEM ArUco.

Espelhado na folha oficial Herby/SAEV (2026_MAT__POR_5ano_1.jpg):
- QR cabeçalho (magic link) em HERBY_QR_HEAD_POS, lado 243;
- QR rodapé (ID) em HERBY_QR_FOOT_POS, lado 142.
A homografia foto→canvas usa os cantos dos QRs detectados
(`detectAndDecodeMulti` devolve os 4 cantos de cada) + o quadrilátero
da página (maior contorno de 4 lados). RANSAC com 6+ pontos.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .config import REPROJ_MAX
from .template_herby import (
    PAGE_W, PAGE_H,
    HERBY_QR_HEAD_POS, HERBY_QR_HEAD_SIZE,
    HERBY_QR_FOOT_POS, HERBY_QR_FOOT_SIZE,
)

QR_IDS = ("qr_head", "qr_foot")

# Calibração: cantos do OpenCV travam ~9% para dentro do box (borda quiet
# zone + anel externo). Medido no sintético p/ v21 e v25, cabeça e rodapé:
# 129/142=0.908, 220/243=0.905, 130.9/142=0.922, 224/243=0.922.
# Expande os quads detectados p/ o box real antes do fit.
QR_CORNER_EXPAND = 1.10


def _expand_quad(quad: np.ndarray, factor: float = QR_CORNER_EXPAND) -> np.ndarray:
    c = quad.mean(axis=0)
    return (quad - c) * factor + c


def _qr_box(pos: tuple[int, int], size: int) -> np.ndarray:
    x, y = pos
    return np.array([
        [x, y], [x + size, y],
        [x + size, y + size], [x, y + size],
    ], dtype=np.float32)


HERBY_QR_DST = {
    "qr_head": _qr_box(HERBY_QR_HEAD_POS, HERBY_QR_HEAD_SIZE),
    "qr_foot": _qr_box(HERBY_QR_FOOT_POS, HERBY_QR_FOOT_SIZE),
}
HERBY_PAGE_DST = np.array([
    [0, 0], [PAGE_W, 0], [PAGE_W, PAGE_H], [0, PAGE_H],
], dtype=np.float32)


@dataclass
class HerbyDetectionResult:
    pairs: list = field(default_factory=list)  # [(src_xy, dst_xy)] p/ homografia
    qr_data: dict = field(default_factory=dict)  # qr_head/qr_foot -> texto decodificado
    has_page: bool = False  # borda da página contribuiu (pontos bem espalhados)
    found: bool = False
    missing: list = field(default_factory=list)  # subset de qr_head/qr_foot/page


def _order_page_quad(pts: np.ndarray) -> np.ndarray:
    """Ordena 4 pontos em TL/TR/BR/BL (soma/diferença)."""
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array([
        pts[np.argmin(s)],   # TL
        pts[np.argmin(d)],   # TR
        pts[np.argmax(s)],   # BR
        pts[np.argmax(d)],   # BL
    ], dtype=np.float32)


def _page_quad(gray: np.ndarray) -> np.ndarray | None:
    """Maior quadrilátero convexo (a folha) — área > 25% da imagem."""
    h, w = gray.shape[:2]
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    best_area = float(h * w) * 0.25
    for cnt in contours:
        area = float(cv2.contourArea(cnt))
        if area < best_area:
            continue
        peri = float(cv2.arcLength(cnt, True))
        if peri <= 0:
            continue
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            best, best_area = approx.reshape(-1, 2).astype(np.float32), area
    if best is None:
        return None
    return _order_page_quad(best)


def detect_herby_anchors(image: np.ndarray) -> HerbyDetectionResult:
    """Detecta QRs + borda da página. found = há ≥4 correspondências."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    res = HerbyDetectionResult()

    # Upscale p/ QR pequeno: cantos saem com precisão subpixel melhor
    scale = 1.0
    if max(gray.shape[:2]) < 2000:
        scale = 2.0
        gray_big = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    else:
        gray_big = gray

    # 1. QRs (cantos + conteúdo para distinguir cabeça/rodapé)
    try:
        det = cv2.QRCodeDetector()
        _ok, decoded, points, _ = det.detectAndDecodeMulti(gray_big)
    except cv2.error:
        decoded, points = (), None
    if points is not None and decoded is not None:
        for raw, quad in zip(list(decoded), list(points)):
            text = (raw or "").strip()
            if not text:
                continue
            # cabeçalho = magic link (http) ou o de cima; rodapé = ID ou o de baixo
            is_head = text.startswith("http")
            if not is_head:
                cy = float(np.asarray(quad).reshape(-1, 2)[:, 1].mean()) / scale
                is_head = cy < gray.shape[0] / 2
            key = "qr_head" if is_head else "qr_foot"
            if key in res.qr_data:
                continue  # duplicata (ex.: mesmo QR 2×) — mantém o primeiro
            res.qr_data[key] = text
            quad_o = _expand_quad(
                np.asarray(quad).reshape(-1, 2).astype(np.float32) / scale)
            # cantos (expandidos p/ o box real) vêm em ordem TL,TR,BR,BL —
            # pareia com o box do template
            for s_pt, d_pt in zip(_order_page_quad(quad_o), HERBY_QR_DST[key]):
                res.pairs.append((tuple(map(float, s_pt)), tuple(map(float, d_pt))))

    # 2. Borda da página
    try:
        page = _page_quad(gray)
    except cv2.error:
        page = None
    if page is not None:
        res.has_page = True
        for s_pt, d_pt in zip(page, HERBY_PAGE_DST):
            res.pairs.append((tuple(map(float, s_pt)), tuple(map(float, d_pt))))
    else:
        res.missing.append("page")

    for key in QR_IDS:
        if key not in res.qr_data:
            res.missing.append(key)
    res.found = len(res.pairs) >= 4
    return res


def herby_homography(det: HerbyDetectionResult) -> np.ndarray | None:
    """Homografia foto→canvas em dois regimes (pontos dos QRs ficam à esquerda):
    - com borda da página: projetiva + RANSAC (pontos bem espalhados);
    - só QRs: similaridade (rotação+escala+translação) — projetiva pura com
      pontos agrupados extrapola mal (escala Y errada longe dos QRs).
    O resultado é APROXIMADO (cantos do detector têm viés para dentro);
    reader_herby refina com refine_herby_qr_boxes() na retificada.
    """
    if len(det.pairs) < 4:
        return None
    src = np.array([p[0] for p in det.pairs], dtype=np.float32)
    dst = np.array([p[1] for p in det.pairs], dtype=np.float32)
    try:
        if det.has_page and len(det.pairs) >= 6:
            M, _ = cv2.findHomography(src, dst, cv2.RANSAC, REPROJ_MAX)
            return M
        if det.has_page:
            M, _ = cv2.findHomography(src, dst, 0)
            return M
        # Só QRs (agrupados à esquerda): afim completa (6 DOF: escala
        # anisotrópica + shear) — similaridade (4 DOF) erra a escala Y longe
        # dos QRs (evidência: topo -12px, base 0 em fotos reais).
        A, _ = cv2.estimateAffine2D(src, dst, method=cv2.RANSAC,
                                    ransacReprojThreshold=REPROJ_MAX)
        if A is None:
            return None
        return np.vstack([A, [0, 0, 1]])
    except cv2.error:
        return None


def _template_box(pos: tuple[int, int], size: int) -> np.ndarray:
    x, y = pos
    return np.array([[x, y], [x + size, y], [x + size, y + size], [x, y + size]],
                    dtype=np.float32)


def refine_herby_qr_boxes(gray_rectified: np.ndarray, margin: int = 60) -> np.ndarray | None:
    """Refino: na imagem já retificada, re-localiza os 2 QRs com precisão
    (maior quad escuro perto do box esperado) e devolve a correção M2
    (retificada→template). None se nada confiável."""
    from .template_herby import HERBY_QR_HEAD_POS, HERBY_QR_HEAD_SIZE
    from .template_herby import HERBY_QR_FOOT_POS, HERBY_QR_FOOT_SIZE
    h, w = gray_rectified.shape[:2]
    src_pts: list = []
    dst_pts: list = []
    for (pos, size) in ((HERBY_QR_HEAD_POS, HERBY_QR_HEAD_SIZE),
                        (HERBY_QR_FOOT_POS, HERBY_QR_FOOT_SIZE)):
        x, y = pos
        x0 = max(0, x - margin); y0 = max(0, y - margin)
        x1 = min(w, x + size + margin); y1 = min(h, y + size + margin)
        if x1 <= x0 or y1 <= y0:
            continue
        crop = gray_rectified[y0:y1, x0:x1]
        _, bw = cv2.threshold(crop, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
        contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        want = float(size * size)
        best = None
        best_score = -1.0
        for cnt in contours:
            area = float(cv2.contourArea(cnt))
            if not (0.35 * want <= area <= 1.35 * want):
                continue
            # minAreaRect: robusto a cantos arredondados pelo upscale do warp
            rect = cv2.minAreaRect(cnt)
            (rw, rh) = rect[1]
            if rw <= 0 or rh <= 0:
                continue
            if max(rw, rh) / min(rw, rh) > 1.35:  # QR é quadrado
                continue
            # prefere o quad de área mais próxima do box esperado
            score = 1.0 - abs(area - want) / want
            if score > best_score:
                best_score = score
                best = cv2.boxPoints(rect).astype(np.float32)
        if best is None:
            continue
        box = _template_box(pos, size)
        for s_pt, d_pt in zip(_order_page_quad(best + np.array([x0, y0], dtype=np.float32)), box):
            src_pts.append(s_pt)
            dst_pts.append(d_pt)
    if len(src_pts) < 4:
        return None
    try:
        M2, _ = cv2.findHomography(np.array(src_pts, dtype=np.float32),
                                   np.array(dst_pts, dtype=np.float32), 0)
        return M2
    except cv2.error:
        return None


def refine_herby_grid(gray_rectified: np.ndarray, qps: int) -> np.ndarray | None:
    """Refino fino pela GRADE: casa quadrados detectados com o template.

    Após o warp grosseiro, resíduos de 5-15px com padrão NÃO-linear são
    comuns (perspectiva real com âncoras só à esquerda — projeção 1D não
    resolve). Os 176 quadrados impressos (vazios ou marcados) são âncoras
    espalhadas pela página inteira: detecta quads ~28px via Canny, casa
    cada centro ao quadrado-template mais próximo (<25px) e estima afim
    via RANSAC. Devolve M_corr (retificada→template) ou None.
    """
    from .template_herby import herby_block_rows, herby_bubble_center
    h, w = gray_rectified.shape[:2]
    x0b, x1b, y0b, y1b = 120, 1340, 600, 1900
    band = gray_rectified[max(0, y0b):min(h, y1b), max(0, x0b):min(w, x1b)]
    if band.size == 0:
        return None
    blur = cv2.GaussianBlur(band, (3, 3), 0)
    edges = cv2.Canny(blur, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    det = []
    for cnt in contours:
        peri = float(cv2.arcLength(cnt, True))
        if peri < 60:
            continue
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue
        pts = approx.reshape(-1, 2).astype(np.float32)
        edges_len = [float(np.linalg.norm(pts[i] - pts[(i + 1) % 4])) for i in range(4)]
        side = sum(edges_len) / 4
        if not (16 <= side <= 40):
            continue
        if max(edges_len) / max(1.0, min(edges_len)) > 1.35:
            continue
        m = cv2.moments(cnt)
        if m["m00"] <= 0:
            continue
        det.append((m["m10"] / m["m00"] + x0b, m["m01"] / m["m00"] + y0b))
    if len(det) < 12:
        return None
    tmpl = []
    for _q, col, r in herby_block_rows(qps):
        for ci in range(4):
            tmpl.append(herby_bubble_center(col, r, ci, qps))
    tmpl = np.array(tmpl, dtype=np.float32)
    det_arr = np.array(det, dtype=np.float32)
    # vizinho template mais próximo (<25px), com unicidade
    used = set()
    pairs = []
    for d in det_arr:
        dists = np.linalg.norm(tmpl - d, axis=1)
        j = int(np.argmin(dists))
        if dists[j] < 25.0 and j not in used:
            used.add(j)
            pairs.append((d, tmpl[j]))
    if len(pairs) < 10:
        return None
    src = np.array([p[0] for p in pairs], dtype=np.float32)
    dst = np.array([p[1] for p in pairs], dtype=np.float32)
    if src[:, 0].max() - src[:, 0].min() < 600 or src[:, 1].max() - src[:, 1].min() < 600:
        return None
    try:
        A, mask = cv2.estimateAffine2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4.0)
    except cv2.error:
        return None
    if A is None or int((mask > 0).sum()) < 10:
        return None
    lin = A[:, :2]
    s = np.linalg.norm(lin, axis=0)
    if not (0.92 <= s[0] <= 1.08 and 0.92 <= s[1] <= 1.08):
        return None
    if abs(float(A[0, 2])) > 40 or abs(float(A[1, 2])) > 40:
        return None
    return np.vstack([A, [0, 0, 1]])


__all__ = [
    "HerbyDetectionResult",
    "detect_herby_anchors",
    "herby_homography",
    "refine_herby_qr_boxes",
    "refine_herby_grid",
    "PAGE_W",
    "PAGE_H",
]
