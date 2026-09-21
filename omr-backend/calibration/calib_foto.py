"""Calibração com foto real: imprime scores por questão para ajuste de limiares.

Uso: python calib_foto.py <foto.jpg> [--qps 22] [--modo dual] [--questoes 28,29,30] [--adaptive]
Com --adaptive, compara fixo x adaptativo lado a lado.
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
ap.add_argument('--adaptive', action='store_true',
                help='compara limiar fixo x adaptativo lado a lado')
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

if args.adaptive:
    ra = process_image(img, questions_per_subject=args.qps,
                       layout_mode=args.modo, adaptive=True)
    if ra is None:
        print('ADAPTATIVO: pipeline retornou None')
        sys.exit(1)
    print(f'\n[fixo]      floor={r.floor_used:.3f} ok={len(r.answers)} '
          f'brancas={len(r.blank_questions)} dups={sorted(r.duplicate_questions)} '
          f'low={sorted(r.low_confidence)}')
    print(f'[adaptativo] floor={ra.floor_used:.3f} ({ra.floor_source}) ok={len(ra.answers)} '
          f'brancas={len(ra.blank_questions)} dups={sorted(ra.duplicate_questions)} '
          f'low={sorted(ra.low_confidence)}')
    div = sorted(set(r.answers) ^ set(ra.answers))
    print(f'divergência nas respostas: {div if div else "nenhuma"}')
