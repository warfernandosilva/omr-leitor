"""A/B: Otsu x first-large-gap nas fotos de calibration/ + sintético.

Uso: python compare_floors.py [--qps 22]
Veredito pela regra de calibration/README.md: vence quem tiver mais `ok`
sem espúrio novo (dup/low a mais). Não muda default — só evidência.
"""
import sys
sys.path.insert(0, '.')
import argparse
import glob
import os

import cv2

from omr.reader import process_image
from omr.reader_saev import process_saev_image
from omr.thresholds import compute_floor

ap = argparse.ArgumentParser()
ap.add_argument('--qps', type=int, default=22)
args = ap.parse_args()

rows = []


def eval_ratios(all_ratios, hi, tag):
    flat = [s for qr in all_ratios.values() for s in qr.values()]
    fo, _ = compute_floor(flat, 'otsu', hi)
    fg, _ = compute_floor(flat, 'gap', hi)
    return fo, fg


print(f"{'foto':60s} {'otsu':>7s} {'gap':>7s}")
tot = {"otsu": 0.0, "gap": 0.0}
n = 0
for foto in sorted(glob.glob(os.path.join('calibration', '*.jpeg'))):
    img = cv2.imread(foto)
    if img is None:
        continue
    name = os.path.basename(foto)
    try:
        if 'saev' in name.lower() or 'gabi' in name.lower() or 'novo' in name.lower() or 'img ' in name.lower():
            r = process_saev_image(img, questions_per_subject=args.qps, adaptive=True)
            hi = 0.55
        else:
            r = process_image(img, questions_per_subject=args.qps, layout_mode='dual', adaptive=True)
            hi = 0.45
    except Exception as e:
        print(f"{name:60s} ERRO {type(e).__name__}")
        continue
    if r is None:
        print(f"{name:60s} None (sem âncoras)")
        continue
    fo, fg = eval_ratios(r.all_ratios, hi, name)
    ok = len(r.answers)
    print(f"{name:60s} {fo:7.3f} {fg:7.3f}  ok={ok} dups={len(r.duplicate_questions)} low={len(r.low_confidence)}")
    tot["otsu"] += fo
    tot["gap"] += fg
    n += 1

if n:
    print(f"\nmédia otsu={tot['otsu']/n:.3f} gap={tot['gap']/n:.3f} sobre {n} fotos")
print("NOTA: divisor menor lê mais (risco de fantasma); maior lê menos (risco de branco).")
print("Veredito exige reprocessar com cada divisor — ver calibration/README.md.")
