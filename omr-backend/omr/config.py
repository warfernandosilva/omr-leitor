"""Constantes OMR compartilhadas — única fonte de verdade para thresholds."""
FLOOR = 0.30
MARGIN = 0.15
LOW_CONF_THRESHOLD = FLOOR + 0.10
BLUR_THRESHOLD = 35.0  # aviso; bloqueio só abaixo de BLUR_BLOCK
BLUR_BLOCK = 15.0  # extremamente borrada — pipeline retorna None
# Cascata de detecção ArUco (taxa de detecção é a métrica principal)
DETECT_SCALES = (1.0, 0.8, 1.25)
REPROJ_MAX = 3.0  # px, erro máximo de reprojeção da homografia RANSAC
GEO_MIN_DIM = 0.06  # fração da minDim para top_w/left_h
GEO_ASPECT_MIN = 0.25
GEO_ASPECT_MAX = 1.6
