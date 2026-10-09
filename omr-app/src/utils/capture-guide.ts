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
import { CaptureTemplate, normalizedAnchorBox } from './anchors';

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

// Maior A4 (proporção real, sem distorção) que cabe no visor viewW×viewH
export function guideRectFor(viewW: number, viewH: number): GuideRect {
  if (!(viewW > 0) || !(viewH > 0)) return fallbackGuide();
  const avail = 100 - VIEW_MARGIN * 2;
  const viewAspect = viewW / viewH; // w/h em pixels
  // largura-fw → altura-fh mantendo A4 em pixels: w_px/h_px = CARD_ASPECT
  // (w/100*viewW) / (h/100*viewH) = CARD_ASPECT  →  h = w * viewAspect / CARD_ASPECT
  let w = avail;
  let h = (w * viewAspect) / CARD_ASPECT;
  if (h > avail) {
    h = avail;
    w = (h * CARD_ASPECT) / viewAspect;
  }
  return { x: (100 - w) / 2, y: (100 - h) / 2, w, h };
}

// Guia padrão quando o visor ainda não foi medido (celular retrato típico)
export function fallbackGuide(): GuideRect {
  return guideRectFor(360, 640);
}

// Posição das 4 âncoras projetadas dentro do guia (coords 0..100 do overlay)
export function anchorTargetsFor(template: CaptureTemplate, guide: GuideRect): AnchorTargets {
  const box = normalizedAnchorBox(template);
  const px = (fx: number) => guide.x + fx * guide.w;
  const py = (fy: number) => guide.y + fy * guide.h;
  return {
    TL: { x: px(box.x0), y: py(box.y0) },
    TR: { x: px(box.x1), y: py(box.y0) },
    BR: { x: px(box.x1), y: py(box.y1) },
    BL: { x: px(box.x0), y: py(box.y1) },
  };
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

// Mapeia o templateType da prova (legado sem tipo = padrão)
export function captureTemplateFor(templateType?: string): CaptureTemplate {
  if (templateType === 'sae') return 'sae';
  if (templateType === 'colar') return 'colar';
  if (templateType === 'saev') return 'saev';
  if (templateType === 'herby') return 'herby';
  if (templateType === 'simulado') return 'simulado';
  return 'padrao';
}
