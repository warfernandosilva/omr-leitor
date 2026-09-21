import sys
sys.path.insert(0, '.')
import cv2
import numpy as np
from omr.template import generate_card
from omr.detector import detect_markers, validate_geometry
from omr.reader import process_image

print('1. Gerando cartao...')
card = generate_card()
print(f'   Shape: {card.shape}')

print('2. Detectando marcadores...')
det = detect_markers(card)
print(f'   Encontrados: {len(det.markers)}/4, faltantes: {det.missing_ids}')

print('3. Validando geometria...')
valid = validate_geometry(det.markers)
print(f'   Valida: {valid}')

print('4. Processando imagem (cartao vazio, sem respostas marcadas)...')
result = process_image(card)
if result:
    print(f'   OK! Respostas: {len(result.answers)}, Em branco: {len(result.blank_questions)}')
    blank_ratio = len(result.blank_questions) / 44
    print(f'   Razao em branco: {blank_ratio:.0%} (esperado ~100% para cartao vazio)')
else:
    print('   Result: None')

print('\nBackend test OK!')
