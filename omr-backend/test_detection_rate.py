"""Taxa de detecção ArUco sob degradações (rotação, escala, blur, sombra, JPEG)."""
import sys
sys.path.insert(0, '.')
import cv2
import numpy as np
from omr.template import generate_card
from omr.detector import detect_markers, validate_geometry


def degrade(img, name):
    h, w = img.shape[:2]
    if name == 'clean':
        return img
    if name == 'rot+5':
        M = cv2.getRotationMatrix2D((w / 2, h / 2), 5, 1.0)
        return cv2.warpAffine(img, M, (w, h), borderValue=(255, 255, 255))
    if name == 'rot-8':
        M = cv2.getRotationMatrix2D((w / 2, h / 2), -8, 1.0)
        return cv2.warpAffine(img, M, (w, h), borderValue=(255, 255, 255))
    if name == 'small':
        small = cv2.resize(img, None, fx=0.6, fy=0.6, interpolation=cv2.INTER_AREA)
        canvas = np.ones_like(img) * 255
        sh, sw = small.shape[:2]
        canvas[(h - sh) // 2:(h - sh) // 2 + sh, (w - sw) // 2:(w - sw) // 2 + sw] = small
        return canvas
    if name == 'blur':
        return cv2.GaussianBlur(img, (5, 5), 0)
    if name == 'shadow':
        out = img.astype(np.float32).copy()
        yy, _ = np.mgrid[0:h, 0:w]
        factor = (0.55 + 0.45 * yy / h)[..., None]
        return np.clip(out * factor, 0, 255).astype(np.uint8)
    if name == 'jpeg':
        _, buf = cv2.imencode('.jpg', img, [int(cv2.IMWRITE_JPEG_QUALITY), 40])
        return cv2.imdecode(buf, cv2.IMREAD_COLOR)
    raise ValueError(name)


def main():
    card = generate_card()
    conds = ['clean', 'rot+5', 'rot-8', 'small', 'blur', 'shadow', 'jpeg']
    ok = 0
    for name in conds:
        img = degrade(card, name)
        det = detect_markers(img)
        geo = validate_geometry(det.markers, img.shape[1], img.shape[0])
        passed = len(det.found_ids) == 4 and geo
        ok += passed
        print(f'{name:8s} found={sorted(det.found_ids)} geo={geo} -> {"OK" if passed else "FAIL"}')
    print(f'\nTaxa: {ok}/{len(conds)} ({ok/len(conds)*100:.0f}%)')
    sys.exit(0 if ok >= 6 else 1)


if __name__ == '__main__':
    main()
