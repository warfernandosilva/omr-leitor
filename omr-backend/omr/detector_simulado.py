"""
Âncoras do modelo Simulado: as réguas da tabela — SEM marcador dedicado.

Estratégia (calibrada na foto real IMG/20261008_203236.jpg, Fase 0):
1. blur 5x5 -> Otsu invertido -> binário (tinta = 255);
2. deskew pela variancia da projeção de linhas (±3°, 0.1° + refino 0.01°);
3. projecao de linhas horizontais (limiar 0.45 * max, gap <= 3 px) -> reguas;
4. extremo esquerdo/direito de cada régua = maior trecho contínuo de tinta,
   depois ajuste robusto (MAD, k sigma); o cabeçalho sai do ajuste direito
   (o degrau de 6 px do JPG);
5. janela de 25 (tabela) ou 23 (so a caixa de dados) reguas consecutivas ->
   4 quinas -> homografia RANSAC -> validacao (aresta de pe, aspecto,
   residuo); vence a janela de 25 e, em empate, a de maior cobertura e menor
   residuo. Uma linha de escrita ou uma segunda folha vira regua extra sem
   derrubar a deteccao; foto com aresta inclinada pela escrita e recusada.

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
REGUA_MAX = 32         # tabela completa = 25; sobra p/ escrita e 2a folha na foto
LINE_GAP = 3           # px sem tinta que ainda conta como o mesmo traço; baixo de
                       # proposito: o par do cabecalho tem ~12 px de folga e fundir
                       # as duas regras deixa a contagem ambigua (24). Regra partida
                       # vira regua extra, e a busca por janela absorve isso.
COL_GAP = 2            # gaps do maior trecho de tinta de uma regua
INK_FRAC = 0.4         # fracao da mediana de tinta que ainda e a propria regua
EXTENT_MIN_FRAC = 0.7  # janela de 23 nao pode trazer regua curta (cabecalho/ruido)
THR_FRAC = 0.45        # fracao do pico da projecao
PAD = 10               # ignora as bordas da imagem (artefato de rotacao)
DESKEW_MAX = 3.0       # graus
MAD_K = 2.5            # rejeicao robusta
EDGE_SLOPE_MAX = 0.08  # aresta da tabela deve ser quase vertical apos o deskew
RESID_TOL = 45.0       # px no canvas entre regua detectada e a do template
MIN_COVER = 0.5        # fracao de reguas que precisa casar

SIM_DST = np.array([
    [SIMULADO_V[0], SIMULADO_H_TOP],
    [SIMULADO_V[5], SIMULADO_H_TOP],
    [SIMULADO_V[5], SIMULADO_H_BOTTOM],
    [SIMULADO_V[0], SIMULADO_H_BOTTOM],
], dtype=np.float32)

# janela que nao ve o cabecalho mapeia a caixa de dados (23 reguas), nao a tabela
SIM_DST_DATA = np.array([
    [SIMULADO_V[0], SIMULADO_H_DATA_TOP],
    [SIMULADO_V[5], SIMULADO_H_DATA_TOP],
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
    # True = as quinas sao da caixa de dados (sem cabecalho); a homografia
    # destino passa a ser SIM_DST_DATA e nao a tabela inteira.
    data_only: bool = False


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


def _header_drop(ys_w: np.ndarray) -> int:
    """0 = sem cabecalho no topo, 2 = cabecalho completo. Assinatura = gap pequeno."""
    gaps = np.diff(ys_w)
    if len(gaps) < 3:
        return 0
    i = int(np.argmin(gaps))
    if gaps[i] < 0.5 * float(np.median(gaps)) and i + 1 in (0, 2):
        return i + 1
    return 0


def _fit_window(ys_w: np.ndarray, xmins_w: np.ndarray, xmaxs_w: np.ndarray,
                xmid_w: np.ndarray, m_inv: np.ndarray, ds: float, size: int) -> dict:
    """Ajusta uma janela de reguas ate as 4 quinas.

    Devolve {"missing": None, cover, max_resid, corners} quando a janela passa,
    ou {"missing": "<motivo>"} quando falha (motivo p/ o report de erro).
    """
    drop = _header_drop(ys_w)
    use_l = ~np.isnan(xmins_w)
    use_r = np.ones(size, dtype=bool)
    use_r[:drop] = False
    if use_l.sum() < 4 or use_r.sum() < 4:
        return {"missing": "quad"}
    # a caixa de dados tem reguas largas; o cabecalho (e o ruido de escrita)
    # tem regua curta. Sem isso uma janela de 23 que ainda traz o cabecalho
    # passa e desloca a grade.
    if size == 23:
        lens = xmaxs_w - xmins_w
        med_len = float(np.median(lens))
        if med_len <= 0 or float(np.nanmin(lens)) < EXTENT_MIN_FRAC * med_len:
            return {"missing": "quad"}
    al, _, _ = _robust_line(ys_w, xmins_w, use_l)
    ar, _, _ = _robust_line(ys_w, xmaxs_w, use_r)
    # escrita solta na foto faz a areda inclinar; a mesa de verdade fica de pe
    if max(abs(float(al[0])), abs(float(ar[0]))) > EDGE_SLOPE_MAX:
        return {"missing": "quad"}

    y_top, y_bot = float(ys_w[0]), float(ys_w[-1])
    if y_bot <= y_top:
        return {"missing": "reguas"}
    quad_r = np.float32([
        [al[0] * y_top + al[1], y_top],
        [ar[0] * y_top + ar[1], y_top],
        [ar[0] * y_bot + ar[1], y_bot],
        [al[0] * y_bot + al[1], y_bot],
    ])
    if quad_r[:, 0].max() - quad_r[:, 0].min() <= 0:
        return {"missing": "quad"}

    ph = np.hstack([quad_r, np.ones((4, 1), np.float32)]).astype(np.float64)
    corners = (m_inv @ ph.T).T[:, :2] / ds

    tl, tr, br, bl = corners
    top = float(np.linalg.norm(tr - tl)); bot = float(np.linalg.norm(br - bl))
    left = float(np.linalg.norm(bl - tl)); right = float(np.linalg.norm(br - tr))
    if min(top, bot, left, right) <= 0:
        return {"missing": "quad"}
    if max(top, bot) / min(top, bot) > 1.6 or max(left, right) / min(left, right) > 1.6:
        return {"missing": "quad"}
    aspect = ((top + bot) / 2.0) / ((left + right) / 2.0)
    if not (SIM_ASPECT * 0.7 <= aspect <= SIM_ASPECT * 1.3):
        return {"missing": "quad"}

    try:
        M, _ = cv2.findHomography(corners.astype(np.float32),
                                  SIM_DST_DATA if size == 23 else SIM_DST,
                                  cv2.RANSAC, REPROJ_MAX)
    except cv2.error:
        M = None
    if M is None:
        return {"missing": "quad"}

    used = ~np.isnan(xmid_w)
    if used.sum() < 4:
        return {"missing": "quad"}
    pts_r = np.hstack([xmid_w[used, None], ys_w[used, None],
                       np.ones((int(used.sum()), 1))])
    pts = ((m_inv @ pts_r.T).T[:, :2]) / ds          # volta p/ coords da foto
    proj = (M @ np.hstack([pts, np.ones((len(pts), 1))]).T).T
    canvas_y = proj[:, 1] / proj[:, 2]
    # janela de 23 so pode casar com as linhas de dados: sem isso uma janela que
    # ainda traz o cabecalho passa no residuo (que e invariante a deslocamento)
    # e desloca a grade inteira em 2 linhas.
    alvo = SIM_TEMPLATE_LINES[2:] if size == 23 else SIM_TEMPLATE_LINES
    nearest = np.abs(canvas_y[:, None] - alvo[None, :]).min(axis=1)
    max_resid = float(nearest.max())
    cover = float((nearest <= RESID_TOL).mean())
    if max_resid > RESID_TOL or cover < MIN_COVER:
        return {"missing": "residuo"}
    return {"missing": None, "cover": cover, "max_resid": max_resid,
            "corners": corners, "data_only": size == 23}


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
        cols = strip.sum(axis=0).astype(np.float64)
        ink = cols[cols > 0]
        if not len(ink):
            continue
        # maior trecho continuo de tinta: escrita e mesa fora da regua nao contam
        runs = _runs(cols >= INK_FRAC * float(np.median(ink)), maxgap=COL_GAP)
        if not runs:
            continue
        run = max(runs, key=lambda r: (r[1] - r[0], float(cols[r[0]:r[1] + 1].sum())))
        xmins[k] = float(run[0] + PAD)
        xmaxs[k] = float(run[1] + PAD)
        xmid[k] = 0.5 * (xmins[k] + xmaxs[k])
    valid = ~np.isnan(xmins)
    if valid.sum() < REGUA_MIN:
        return SimuladoDetectionResult(found=False, angle=ang, n_reguas=n, missing=["extremos"])

    # busca por janela: a tabela completa e 25 reguas (ou 23 sem o cabecalho).
    # Uma linha de escrita ou uma 2a folha vira regua extra; a janela certa
    # existe mesmo assim e e a de menor residuo / maior cobertura.
    best = None
    fails: dict[str, int] = {}
    for size in (25, 23):
        for s in range(0, n - size + 1):
            fit = _fit_window(ys[s:s + size], xmins[s:s + size], xmaxs[s:s + size],
                              xmid[s:s + size], m_inv, ds, size)
            if fit["missing"]:
                fails[fit["missing"]] = fails.get(fit["missing"], 0) + 1
            else:
                # desempate: 25 antes de 23, depois cobertura, depois resíduo
                score = (size, fit["cover"], -fit["max_resid"])
                if best is None or score > best[0]:
                    best = (score, fit)
    if best is None:
        worst = max(fails, key=fails.get) if fails else "reguas"
        return SimuladoDetectionResult(found=False, angle=ang, n_reguas=n, missing=[worst])

    win = best[1]
    corners = win["corners"]
    ordered = {"TL": corners[0], "TR": corners[1], "BR": corners[2], "BL": corners[3]}
    return SimuladoDetectionResult(corners=ordered, n_reguas=n, angle=ang, found=True,
                                   data_only=bool(win["data_only"]))


def simulado_homography(det: SimuladoDetectionResult) -> np.ndarray | None:
    """Homografia foto -> canvas 1448x2048 a partir das 4 quinas."""
    if not det.found:
        return None
    try:
        src = np.array([det.corners[k] for k in ("TL", "TR", "BR", "BL")], dtype=np.float32)
    except KeyError:
        return None
    try:
        M, _ = cv2.findHomography(src, SIM_DST_DATA if det.data_only else SIM_DST,
                                  cv2.RANSAC, REPROJ_MAX)
        return M
    except cv2.error:
        return None


__all__ = [
    "SimuladoDetectionResult",
    "detect_simulado_table",
    "simulado_homography",
    "SIM_DST",
    "SIM_DST_DATA",
    "SIM_ASPECT",
]
