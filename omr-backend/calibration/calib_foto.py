"""Calibração com foto real: imprime scores por questão para ajuste de limiares.

Uso: python calib_foto.py <foto.jpg> [--qps 22] [--modo dual] [--questoes 28,29,30]
"""
import sys
sys.path.insert(0, '.')
import argparse
import cv2
from omr.reader import process_image

ap = argparse.ArgumentParser()
ap.add_argument('foto')
ap.add_argument('--qps', type=int, default=22)
ap.add_argument('--modo', default='dual')
ap.add_argument('--questoes', default='')
args = ap.parse_args()

img = cv2.imread(args.foto)
if img is None:
    print('ERRO: não foi possível ler', args.foto)
    sys.exit(1)
r = process_image(img, questions_per_subject=args.qps, layout_mode=args.modo)
if r is None:
    print('ERRO: pipeline retornou None (marcadores/geometria/blur)')
    sys.exit(1)

alvo = set()
if args.questoes.strip():
    alvo = {int(x) for x in args.questoes.split(',')}
else:
    alvo = set(r.duplicate_questions) | set(r.low_confidence)

print(f'duplicadas: {sorted(r.duplicate_questions)}')
print(f'baixa_conf: {sorted(r.low_confidence)}')
print(f'brancas: {len(r.blank_questions)}')
for q in sorted(alvo):
    rr = r.all_ratios.get(q, {})
    cells = ' '.join(f'{l}={s:.3f}' for l, s in sorted(rr.items()))
    print(f'Q{q:2d}: {cells}')
