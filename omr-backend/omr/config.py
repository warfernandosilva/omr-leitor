"""Constantes OMR compartilhadas — única fonte de verdade para thresholds."""
FLOOR = 0.30
MARGIN = 0.22
LOW_CONF_THRESHOLD = 0.35

# ─── Entrada de imagem ───
# Portado do amazingOMR: uma foto gigante é reduzida ANTES da detecção para
# que a cascata de ArUco (que amplia ×3) não estoure memória/tempo.
MAX_INPUT_SIDE_PX = 7000
MIN_INPUT_SIDE_PX = 8
UPSCALE_PIXEL_BUDGET = 60_000_000

# ─── Scoring fino (opcional, ligado por OmrParams) ───
LOCAL_SNAP_PX = 2          # deslocamento local máx. da ROI até a tinta
FAINT_DARKNESS = 0.18      # marca fraca visível: nunca vira "em branco"
CANCEL_REPLACE_GAP = 0.25  # gap p/ resolver "apagou e marcou outra"
# Gabarito Personalizado — dupla resolvida pela marca mais escura: o vencedor
# precisa abrir este gap (fração do MARGIN) sobre a 2ª marca para ser aceito.
DARKEST_MARK_GAP_FACTOR = 0.5
BLUR_THRESHOLD = 35.0  # aviso; bloqueio só abaixo de BLUR_BLOCK
BLUR_BLOCK = 15.0  # extremamente borrada — pipeline retorna None
# Cascata de detecção ArUco (taxa de detecção é a métrica principal)
DETECT_SCALES = (1.0, 0.8, 1.25)
REPROJ_MAX = 3.0  # px, erro máximo de reprojeção da homografia RANSAC
GEO_MIN_DIM = 0.06  # fração da minDim para top_w/left_h
GEO_ASPECT_MIN = 0.25
GEO_ASPECT_MAX = 1.6
