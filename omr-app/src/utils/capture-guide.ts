// ─── Guia de captura por modelo de gabarito ───
// Funções puras (testáveis em Node, sem DOM):
// - maior retângulo A4 que cabe no visor, sem distorção;
// - posição das 4 âncoras de cada modelo projetadas no guia (alvos 🎯);
// - limiares do detector calibrados por modelo.
//
// Âncoras normalizadas (0..1 do cartão 1448×2048) vêm de utils/anchors.ts —
// mesma fonte usada pelo recorte do "Gabarito recortado" (gabarito-crop.ts).
import { GuideThresholds, DEFAULT_THRESHOLDS } from './frame-guides';
import { CARD_WIDTH, CARD_HEIGHT } from './card-template';
import { CaptureTemplate, AnchorBox, normalizedAnchorBox } from './anchors';

export type { CaptureTemplate } from './anchors';

export const CARD_ASPECT = CARD_WIDTH / CARD_HEIGHT; // ≈0.7071 (A4 retrato)

// Retângulo em coords normalizadas do overlay (0..100, como o SVG do visor)
export interface GuideRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AnchorTargets {
  TL: { x: number; y: number };
  TR: { x: number; y: number };
  BR: { x: number; y: number };
  BL: { x: number; y: number };
}

// Cantos externos das âncoras vêm de anchors.ts (fonte única, 0..1).

const VIEW_MARGIN = 4; // % livre em cada borda do visor

// Maior retângulo com a proporção `aspect` (w/h) que cabe no visor viewW×viewH
export function guideRectForAspect(viewW: number, viewH: number, aspect: number): GuideRect {
  if (!(viewW > 0) || !(viewH > 0) || !(aspect > 0)) return fallbackGuide();
  const avail = 100 - VIEW_MARGIN * 2;
  const viewAspect = viewW / viewH; // w/h em pixels
  // (w/100*viewW) / (h/100*viewH) = aspect  →  h = w * viewAspect / aspect
  let w = avail;
  let h = (w * viewAspect) / aspect;
  if (h > avail) {
    h = avail;
    w = (h * aspect) / viewAspect;
  }
  return { x: (100 - w) / 2, y: (100 - h) / 2, w, h };
}

// Maior A4 (proporção real, sem distorção) que cabe no visor viewW×viewH
export function guideRectFor(viewW: number, viewH: number): GuideRect {
  return guideRectForAspect(viewW, viewH, CARD_ASPECT);
}

// Guia padrão quando o visor ainda não foi medido (celular retrato típico)
export function fallbackGuide(): GuideRect {
  return guideRectFor(360, 640);
}

// Posição das 4 âncoras projetadas dentro do guia (coords 0..100 do overlay)
export function anchorTargetsForBox(box: AnchorBox, guide: GuideRect): AnchorTargets {
  const px = (fx: number) => guide.x + fx * guide.w;
  const py = (fy: number) => guide.y + fy * guide.h;
  return {
    TL: { x: px(box.x0), y: py(box.y0) },
    TR: { x: px(box.x1), y: py(box.y0) },
    BR: { x: px(box.x1), y: py(box.y1) },
    BL: { x: px(box.x0), y: py(box.y1) },
  };
}

// Posição das 4 âncoras de um modelo nativo projetadas dentro do guia
export function anchorTargetsFor(template: CaptureTemplate, guide: GuideRect): AnchorTargets {
  return anchorTargetsForBox(normalizedAnchorBox(template), guide);
}

// Âncora mínima do guia (posições/quadrado já normalizados 0..1)
export interface GuideAnchor {
  x: number;
  y: number;
  size?: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * BBox normalizado (0..1) das âncoras de um Gabarito Personalizado, para o
 * guia de captura. Espelha o render do preview do backend (quadrado de lado
 * `size` em coords normalizadas). Sem âncoras → página inteira (quadro cheio).
 */
export function customAnchorBox(anchors: readonly GuideAnchor[]): AnchorBox {
  if (!anchors || anchors.length === 0) return { x0: 0, y0: 0, x1: 1, y1: 1 };
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const a of anchors) {
    const h = (a.size ?? 0) / 2;
    x0 = Math.min(x0, a.x - h);
    y0 = Math.min(y0, a.y - h);
    x1 = Math.max(x1, a.x + h);
    y1 = Math.max(y1, a.y + h);
  }
  return { x0: clamp01(x0), y0: clamp01(y0), x1: clamp01(x1), y1: clamp01(y1) };
}

// Limiares do detector por modelo (SAE/Colar: âncoras pequenas, quad menor;
// SAEV/Herby: âncoras grandes/QR, mesma ordem de grandeza do padrão;
// Simulado: sem marcador — modo retângulo único sobre as réguas da tabela)
export function thresholdsFor(template: CaptureTemplate): GuideThresholds {
  if (template === 'padrao') return { ...DEFAULT_THRESHOLDS };
  if (template === 'saev' || template === 'herby') return { ...DEFAULT_THRESHOLDS };
  if (template === 'simulado') {
    return {
      ...DEFAULT_THRESHOLDS,
      singleRect: true,
      // a "malha" da tabela tem baixa densidade (só traços) e enche o quadro
      maxAreaFrac: 0.35,
      minFillRatio: 0.004,
      minCoverage: 0.08,
      maxCoverage: 0.9,
    };
  }
  return {
    ...DEFAULT_THRESHOLDS,
    minAreaFrac: 0.00012, // quadrado 40px ≈ 2.8% da folha (vs ArUco 7.2%)
    minCoverage: 0.08, // quad SAE ≈ 0.31 do frame com a folha cheia
    maxCoverage: 0.7,
  };
}

// Ponto de toque-para-focar normalizado 0..1 (pointsOfInterest), com clamp.
// Função pura p/ teste: o <video> usa objectFit cover preenchendo o visor,
// então a posição relativa ao elemento aproxima a posição no frame visível.
export function tapToFocusPoint(
  viewW: number, viewH: number, offsetX: number, offsetY: number,
): { x: number; y: number } {
  const cx = (v: number) => Math.min(1, Math.max(0, v));
  if (!(viewW > 0) || !(viewH > 0)) return { x: 0.5, y: 0.5 };
  return { x: cx(offsetX / viewW), y: cx(offsetY / viewH) };
}

// Mapeia o templateType da prova (legado sem tipo = padrão)
export function captureTemplateFor(templateType?: string): CaptureTemplate {
  if (templateType === 'sae') return 'sae';
  if (templateType === 'colar') return 'colar';
  if (templateType === 'saev') return 'saev';
  if (templateType === 'herby') return 'herby';
  if (templateType === 'simulado') return 'simulado';
  return 'padrao';
}
