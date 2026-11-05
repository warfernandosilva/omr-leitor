"""Normalização da imagem de entrada do motor OMR.

Portado do amazingOMR (`registration.prepare_image`). Faz três coisas antes
de qualquer detecção:

1. valida forma/dtype (bool, uint16, float, RGBA…);
2. limita o lado maior a `MAX_INPUT_SIDE_PX` (a cascata de ArUco amplia a
   imagem até ×3; uma foto de 12 MP sem limite vira ~100 MP);
3. garante um array uint8 contíguo.

Preserva os canais (BGR continua BGR) para que o warp/retificação e o
overlay de debug continuem coloridos.
"""

from __future__ import annotations

import cv2
import numpy as np

from .config import MAX_INPUT_SIDE_PX, MIN_INPUT_SIDE_PX


class InvalidImage(ValueError):
    """Imagem ausente ou com formato que o motor não consegue ler."""


def prepare_image(image: np.ndarray | None) -> np.ndarray:
    """Valida, normaliza o dtype e reduz a imagem se ela for gigante."""
    if image is None:
        raise InvalidImage("nenhuma imagem informada")

    arr = np.asarray(image)
    if arr.ndim == 3 and arr.shape[2] == 1:
        arr = arr[:, :, 0]
    if arr.ndim != 2 and not (arr.ndim == 3 and arr.shape[2] in (3, 4)):
        raise InvalidImage(f"formato de imagem não suportado: {tuple(arr.shape)}")

    h, w = arr.shape[:2]
    if h < MIN_INPUT_SIDE_PX or w < MIN_INPUT_SIDE_PX:
        raise InvalidImage(f"imagem pequena demais ({w}x{h} px)")

    if arr.dtype != np.uint8:
        if arr.dtype == np.bool_:
            arr = arr.astype(np.uint8) * 255
        elif arr.dtype == np.uint16:
            arr = (arr >> 8).astype(np.uint8)
        elif np.issubdtype(arr.dtype, np.integer):
            arr = np.clip(arr, 0, 255).astype(np.uint8)
        else:
            f = np.nan_to_num(arr.astype(np.float32), nan=0.0,
                              posinf=255.0, neginf=0.0)
            if float(f.max(initial=0.0)) <= 1.0 and float(f.min(initial=0.0)) >= 0.0:
                f = f * 255.0
            arr = np.clip(f, 0, 255).astype(np.uint8)

    longest = max(h, w)
    if longest > MAX_INPUT_SIDE_PX:
        scale = MAX_INPUT_SIDE_PX / float(longest)
        arr = cv2.resize(
            arr,
            (max(MIN_INPUT_SIDE_PX, int(round(w * scale))),
             max(MIN_INPUT_SIDE_PX, int(round(h * scale)))),
            interpolation=cv2.INTER_AREA,
        )

    return np.ascontiguousarray(arr)


def ensure_gray(image: np.ndarray) -> np.ndarray:
    """Converte BGR/BGRA para cinza; devolve como está se já for 2D."""
    if image.ndim == 2:
        return image
    code = cv2.COLOR_BGRA2GRAY if image.shape[2] == 4 else cv2.COLOR_BGR2GRAY
    return cv2.cvtColor(np.ascontiguousarray(image), code)
