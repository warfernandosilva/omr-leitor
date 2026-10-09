// ─── Âncoras de cada gabarito — fonte única ───
// Bounding-box EXTERNO das 4 marcações de âncora, em coords absolutas do
// canvas 1448×2048 (0 px de respiro: o quadro termina na borda do marcador).
//
// Usado por DOIS consumidores, que antes mantinham cópias divergentes:
// - gabarito-crop.ts  → recorte da visualização "Gabarito recortado";
// - capture-guide.ts  → alvos 🎯 do guia de captura no celular.
//
// Mantenha em sincronia com o backend:
// - omr/template.py        ARUCO_CENTERS / ARUCO_SIZE
// - omr/template_saev.py   SAEV_CORNER_CENTERS / SAEV_SQUARE
// - omr/template_sae.py    CORNER_CENTERS / CORNER_SIZE
// - omr/template_simulado.py  SIMULADO_TABLE (réguas, sem marcador dedicado)
import { CARD_WIDTH, CARD_HEIGHT, ARUCO_CENTERS, ARUCO_MARKER_SIZE } from './card-template';
import { SAE_CORNER_CENTERS, SAE_CORNER_SIZE } from './sae-template';
import { SAEV_CORNER_CENTERS, SAEV_CORNER_SIZE } from './saev-template';
import { SIMULADO_TABLE } from './simulado-template';

/** Um dos 6 gabaritos aceitos pelo app (mesmo domínio do `CaptureTemplate` do guia). */
export type CaptureTemplate = 'padrao' | 'sae' | 'colar' | 'saev' | 'herby' | 'simulado';
export type AnchorTemplate = CaptureTemplate;

export interface AnchorBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** BBox externo de um conjunto de marcações centradas num tamanho fixo. */
function boxFromCenters(
  centers: readonly (readonly [number, number])[],
  size: number,
): AnchorBox {
  const h = size / 2;
  const xs = centers.map(c => c[0]);
  const ys = centers.map(c => c[1]);
  return {
    x0: Math.min(...xs) - h,
    y0: Math.min(...ys) - h,
    x1: Math.max(...xs) + h,
    y1: Math.max(...ys) + h,
  };
}

const c = (p: { x: number; y: number }): [number, number] => [p.x, p.y];

const BOXES: Record<AnchorTemplate, AnchorBox> = {
  // ArUco DICT_4X4_50 104px: TL(138,531) TR(1310,531) BR(1310,1876) BL(138,1876)
  padrao: boxFromCenters(
    [c(ARUCO_CENTERS.TL), c(ARUCO_CENTERS.TR), c(ARUCO_CENTERS.BR), c(ARUCO_CENTERS.BL)],
    ARUCO_MARKER_SIZE,
  ),
  // Quadrados pretos 40px: x 64..1384, y 1140..1900 (mesma geometria SAE/Colar)
  sae: boxFromCenters(
    [SAE_CORNER_CENTERS.TL, SAE_CORNER_CENTERS.TR, SAE_CORNER_CENTERS.BR, SAE_CORNER_CENTERS.BL],
    SAE_CORNER_SIZE,
  ),
  colar: boxFromCenters(
    [SAE_CORNER_CENTERS.TL, SAE_CORNER_CENTERS.TR, SAE_CORNER_CENTERS.BR, SAE_CORNER_CENTERS.BL],
    SAE_CORNER_SIZE,
  ),
  // ArUco 104px (trocados dos quadrados 75px em 2026-09-23): x 58..1390, y 493..1957
  saev: boxFromCenters(
    [SAEV_CORNER_CENTERS.TL, SAEV_CORNER_CENTERS.TR, SAEV_CORNER_CENTERS.BR, SAEV_CORNER_CENTERS.BL],
    SAEV_CORNER_SIZE,
  ),
  // TODO(herby): SEM ArUco — âncoras reais são os 2 QRs + bordas da página, e o
  // bbox só dos QRs (121,76 → 600,1991) NÃO enquadra a grade (vai até x=1297).
  // Mantido o valor de sempre para não regredir o guia de captura. Substituir
  // pelos retângulos pretos (e remover o QR do rodapé) quando o gabarito mudar.
  herby: { x0: 121, y0: 76, x1: 1327, y1: 1950 },
  // Simulado: NÃO tem marcador dedicado — as 4 quinas da tabela são as âncoras.
  simulado: { x0: SIMULADO_TABLE[0], y0: SIMULADO_TABLE[1], x1: SIMULADO_TABLE[2], y1: SIMULADO_TABLE[3] },
};

export function anchorBoxFor(template: AnchorTemplate): AnchorBox {
  return BOXES[template];
}

/** Mesmo quadro normalizado (0..1), como o guia de captura projeta. */
export function normalizedAnchorBox(template: AnchorTemplate): AnchorBox {
  const b = BOXES[template];
  return {
    x0: b.x0 / CARD_WIDTH,
    y0: b.y0 / CARD_HEIGHT,
    x1: b.x1 / CARD_WIDTH,
    y1: b.y1 / CARD_HEIGHT,
  };
}
