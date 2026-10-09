"""
Âncoras do modelo Simulado: as réguas da tabela — SEM marcador dedicado.

Estratégia (calibrada na foto real IMG/20261008_203236.jpg, Fase 0):
1. blur 5x5 -> Otsu invertido -> binário (tinta = 255);
2. deskew pela variancia da projeção de linhas (±3°, 0.1° + refino 0.01°);
3. projeção de linhas horizontais (limiar 0.45 * max, gap <= 6 px) -> réguas;
4. extremo esquerdo/direito de cada régua + ajuste robusto (MAD, k sigma);
   o bloco do cabeçalho sai do ajuste direito (o degrau de 6 px do JPG);
5. 4 quinas -> homografia RANSAC -> validação (aspecto + resíduo das réguas).

Sem mesa de trabalho (coluna-projeção não resolve: a perspectiva derruba a
cobertura de V0/V5 para 0,17). Só linhas horizontais, que são retas na foto.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .config import REPROJ_MAX
from .template_simulado import (
    PAGE_W, PAGE_H,
    SIMULADO_V, SIMULADO_H_TOP, SIMULADO_H_HEADER_BOT,
    SIMULADO_H_DATA_TOP, SIMULADO_H_BOTTOM, SIMULADO_ROW_PITCH,
)

# Teto de resolução: foto 1534x3517 -> 2400 de lado maior (ds 0,68).
DETECT_MAX_SIDE = 2400
REGUA_MIN = 6          # mínimo de réguas para sequer tentar
REGUA_MAX = 26         # tabela completa = 25, só dados = 23
LINE_GAP = 6           # px sem tinta que ainda conta como o mesmo traço
THR_FRAC = 0.45        # fração do pico da projeção
PAD = 10               # ignora as bordas da imagem (artefato de rotação)
DESKEW_MAX = 3.0       # graus
MAD_K = 2.5            # rejeição robusta
RESID_TOL = 15.0       # px no canvas entre régua detectada e a do template
MIN_COVER = 0.8        # fração de réguas que precisa casar

SIM_DST = np.array([
    [SIMULADO_V[0], SIMULADO_H_TOP],
    [SIMULADO_V[5], SIMULADO_H_TOP],
    [SIMULADO_V[5], SIMULADO_H_BOTTOM],
    [SIMULADO_V[0], SIMULADO_H_BOTTOM],
], dtype=np.float32)

SIM_ASPECT = float((SIMULADO_V[5] - SIMULADO_V[0]) / (SIMULADO_H_BOTTOM - SIMULADO_H_TOP))

SIM_TEMPLATE_LINES = np.array(
    [SIMULADO_H_TOP, SIMULADO_H_HEADER_BOT]
    + [SIMULADO_H_DATA_TOP + k * SIMULADO_ROW_PITCH for k in range(23)],
    dtype=np.float64,
)


@dataclass
class SimuladoDetectionResult:
    corners: dict[str, tuple[float, float]] = field(default_factory=dict)
    n_reguas: int = 0
    angle: float = 0.0
    found: bool = False
    missing: list[str] = field(default_factory=list)


def _runs(mask: np.ndarray, maxgap: int = LINE_GAP) -> list[tuple[int, int]]:
    """Intervalos [a, b] de True, tolerando até `maxgap` False seguidos."""
    out: list[tuple[int, int]] = []
    i, n = 0, len(mask)
    while i < n:
        if not mask[i]:
            i += 1
            continue
        j, last = i, i
        while j < n:
            if mask[j]:
                last = j
                j += 1
            elif j - last <= maxgap:
                j += 1
            else:
                break
        out.append((i, last))
        i = j
    return out


def _deskew_angle(bw: np.ndarray) -> float:
    """Ângulo (graus, CCW) que maximiza a variancia da projeção de linhas."""
    h, w = bw.shape[:2]
    if min(h, w) < 64:
        return 0.0
    y0, y1 = int(h * 0.1), int(h * 0.9)
    x0, x1 = int(w * 0.1), int(w * 0.9)
    core = bw[y0:y1, x0:x1]
    if core.size == 0:
        return 0.0
    ch, cw = core.shape

    def score(a: float) -> float:
        m = cv2.getRotationMatrix2D((cw / 2.0, ch / 2.0), a, 1.0)
        r = cv2.warpAffine(core, m, (cw, ch), flags=cv2.INTER_NEAREST, borderValue=0)
        v = r.sum(axis=1).astype(np.float64)
        return float((v * v).sum())

    best_a, best_s = 0.0, -1.0
    for a in np.arange(-DESKEW_MAX, DESKEW_MAX + 1e-9, 0.1):
        s = score(float(a))
        if s > best_s:
            best_a, best_s = float(a), s
    for a in np.arange(best_a - 0.1, best_a + 0.1 + 1e-9, 0.01):
        s = score(float(a))
        if s > best_s:
            best_a, best_s = float(a), s
    return best_a


def _robust_line(y: np.ndarray, x: np.ndarray, mask: np.ndarray,
                 ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """x = a*y + b com rejeição iterativa por MAD. Devolve (coef, y_usado, x_usado)."""
    m = mask & ~np.isnan(x)
    yy, xx = y[m].astype(np.float64), x[m].astype(np.float64)
    for _ in range(6):
        if len(yy) < 4:
            break
        A = np.vstack([yy, np.ones_like(yy)]).T
        coef, *_ = np.linalg.lstsq(A, xx, rcond=None)
        res = xx - A @ coef
        med = float(np.median(res))
        sig = 1.4826 * float(np.median(np.abs(res - med)))
        if sig <= 1e-6:
            break
        keep = np.abs(res - med) <= MAD_K * sig
        if keep.all() or keep.sum() < 4:
            break
        yy, xx = yy[keep], xx[keep]
    A = np.vstack([yy, np.ones_like(yy)]).T
    coef, *_ = np.linalg.lstsq(A, xx, rcond=None)
    return coef, yy, xx


def detect_simulado_table(image: np.ndarray) -> SimuladoDetectionResult:
    """Acha as 4 quinas da tabela na foto (coords originais, ordem TL/TR/BR/BL)."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
    ds = 1.0
    longest = max(gray.shape[:2])
    if longest > DETECT_MAX_SIDE:
        ds = DETECT_MAX_SIDE / float(longest)
        gray = cv2.resize(gray, None, fx=ds, fy=ds, interpolation=cv2.INTER_AREA)
    h, w = gray.shape[:2]
    if min(h, w) < 40 or w <= 2 * PAD + 20:
        return SimuladoDetectionResult(found=False, missing=["imagem"])

    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    ang = _deskew_angle(bw)
    m_rot = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), ang, 1.0)
    m_inv = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), -ang, 1.0)
    bin_r = cv2.warpAffine(bw, m_rot, (w, h), flags=cv2.INTER_NEAREST, borderValue=0)

    prof = bin_r[:, PAD:w - PAD].sum(axis=1).astype(np.float64)
    if prof.max() <= 0:
        return SimuladoDetectionResult(found=False, angle=ang, missing=["reguas"])
    spans = _runs(prof >= THR_FRAC * float(prof.max()))
    n = len(spans)
    if not (REGUA_MIN <= n <= REGUA_MAX):
        return SimuladoDetectionResult(found=False, angle=ang, n_reguas=n, missing=["reguas"])

    ys = np.array([
        float((prof[a:b + 1] * np.arange(a, b + 1)).sum() / prof[a:b + 1].sum())
        for a, b in spans
    ], dtype=np.float64)

    xmins = np.full(n, np.nan)
    xmaxs = np.full(n, np.nan)
    xmid = np.full(n, np.nan)
    for k, (a, b) in enumerate(spans):
        strip = bin_r[max(0, a - 1):min(h, b + 2), PAD:w - PAD]
        cols = np.where(strip.any(axis=0))[0]
        if not len(cols):
            continue
        xmins[k] = float(cols.min() + PAD)
        xmaxs[k] = float(cols.max() + PAD)
        xmid[k] = 0.5 * (xmins[k] + xmaxs[k])
    valid = ~np.isnan(xmins)
    if valid.sum() < REGUA_MIN:
        return SimuladoDetectionResult(found=False, angle=ang, n_reguas=n, missing=["extremos"])

    # bloco do cabeçalho: o gap cabecalho->dados é ~0,19 do pitch (16,5/85,2)
    drop = 0
    gaps = np.diff(ys)
    if len(gaps) >= 3:
        i = int(np.argmin(gaps))
        if gaps[i] < 0.5 * float(np.median(gaps)):
            drop = i + 1
    # tabela completa (25 réguas, cabeçalho no lugar) ou só a caixa de dados (23)
    if (drop == 2) != (n == 25):
        return SimuladoDetectionResult(found=False, angle=ang, n_reguas=n,
                                       missing=["reguas"])

    use_r = np.ones(n, dtype=bool)
    use_r[:drop] = False
    al, _, _ = _robust_line(ys, xmins, np.ones(n, dtype=bool))
    ar, _, _ = _robust_line(ys, xmaxs, use_r)

    y_top, y_bot = float(ys[0]), float(ys[-1])
    if y_bot <= y_top:
        return SimuladoDetectionResult(found=False, angle=ang, n_reguas=n, missing=["reguas"])

    quad_r = np.float32([
        [al[0] * y_top + al[1], y_top],
        [ar[0] * y_top + ar[1], y_top],
        [ar[0] * y_bot + ar[1], y_bot],
        [al[0] * y_bot + al[1], y_bot],
    ])
    if quad_r[:, 0].max() - quad_r[:, 0].min() <= 0:
        return SimuladoDetectionResult(found=False, angle=ang, n_reguas=n, missing=["quad"])

    ph = np.hstack([quad_r, np.ones((4, 1), np.float32)]).astype(np.float64)
    corners = (m_inv @ ph.T).T[:, :2] / ds
    ordered = {"TL": corners[0], "TR": corners[1], "BR": corners[2], "BL": corners[3]}

    # aspecto do quadrilátero (mesma tolerância do SAE)
    tl, tr, br, bl = corners
    top = float(np.linalg.norm(tr - tl)); bot = float(np.linalg.norm(br - bl))
    left = float(np.linalg.norm(bl - tl)); right = float(np.linalg.norm(br - tr))
    if min(top, bot, left, right) <= 0:
        return SimuladoDetectionResult(found=False, angle=ang, n_reguas=n, missing=["quad"])
    if max(top, bot) / min(top, bot) > 1.6 or max(left, right) / min(left, right) > 1.6:
        return SimuladoDetectionResult(found=False, angle=ang, n_reguas=n, missing=["quad"])
    aspect = ((top + bot) / 2.0) / ((left + right) / 2.0)
    if not (SIM_ASPECT * 0.7 <= aspect <= SIM_ASPECT * 1.3):
        return SimuladoDetectionResult(found=False, angle=ang, n_reguas=n, missing=["quad"])

    # homografia + resíduo das réguas (pega topo/base trocados)
    try:
        M, _ = cv2.findHomography(corners.astype(np.float32), SIM_DST, cv2.RANSAC, REPROJ_MAX)
    except cv2.error:
        M = None
    if M is None:
        return SimuladoDetectionResult(found=False, angle=ang, n_reguas=n, missing=["quad"])

    used = ~np.isnan(xmid)
    pts_r = np.hstack([xmid[used, None], ys[used, None],
                       np.ones((int(used.sum()), 1))])
    pts = ((m_inv @ pts_r.T).T[:, :2]) / ds          # volta p/ coords da foto
    proj = (M @ np.hstack([pts, np.ones((len(pts), 1))]).T).T
    canvas_y = proj[:, 1] / proj[:, 2]
    nearest = np.abs(canvas_y[:, None] - SIM_TEMPLATE_LINES[None, :]).min(axis=1)
    if nearest.max() > RESID_TOL or (nearest <= RESID_TOL).mean() < MIN_COVER:
        return SimuladoDetectionResult(found=False, angle=ang, n_reguas=n, missing=["residuo"])

    res = SimuladoDetectionResult(corners=ordered, n_reguas=n, angle=ang, found=True)
    return res


def simulado_homography(det: SimuladoDetectionResult) -> np.ndarray | None:
    """Homografia foto -> canvas 1448x2048 a partir das 4 quinas."""
    if not det.found:
        return None
    try:
        src = np.array([det.corners[k] for k in ("TL", "TR", "BR", "BL")], dtype=np.float32)
    except KeyError:
        return None
    try:
        M, _ = cv2.findHomography(src, SIM_DST, cv2.RANSAC, REPROJ_MAX)
        return M
    except cv2.error:
        return None


__all__ = [
    "SimuladoDetectionResult",
    "detect_simulado_table",
    "simulado_homography",
    "SIM_DST",
    "SIM_ASPECT",
]
