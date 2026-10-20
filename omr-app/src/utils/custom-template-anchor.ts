import type { CornerName, CustomAnchor } from './custom-template-api';

export const ANCHOR_CORNERS: readonly CornerName[] = ['TL', 'TR', 'BR', 'BL'];

const CORNER_POINTS: Record<CornerName, { x: number; y: number }> = {
  TL: { x: 0.08, y: 0.08 },
  TR: { x: 0.92, y: 0.08 },
  BR: { x: 0.92, y: 0.92 },
  BL: { x: 0.08, y: 0.92 },
};

export interface AnchorPlacement {
  corner: CornerName | null;
  x: number;
  y: number;
}

/**
 * Posição/canto de uma nova âncora. As 4 primeiras ocupam TL, TR, BR e BL;
 * as seguintes caem numa grade ao redor do centro para não empilharem.
 */
export function nextAnchorPlacement(anchors: CustomAnchor[], page = 0): AnchorPlacement {
  const onPage = anchors.filter((a) => (a.page ?? 0) === page);
  const free = ANCHOR_CORNERS.find((c) => !onPage.some((a) => a.corner === c));
  if (free) return { corner: free, ...CORNER_POINTS[free] };

  const extra = Math.max(0, onPage.length - ANCHOR_CORNERS.length);
  const col = extra % 3;
  const row = Math.floor(extra / 3) % 3;
  return {
    corner: null,
    x: Math.min(0.9, Math.max(0.1, 0.5 + (col - 1) * 0.1)),
    y: Math.min(0.9, Math.max(0.1, 0.5 + (row - 1) * 0.1)),
  };
}

/** Próximo ID ArUco livre na página (respeita o ID preferido, se estiver livre). */
export function nextArucoId(anchors: CustomAnchor[], page = 0, preferred = 0): number {
  const used = new Set(
    anchors
      .filter((a) => (a.page ?? 0) === page && a.type === 'aruco' && a.aruco_id != null)
      .map((a) => a.aruco_id as number),
  );
  let id = Math.max(0, Math.trunc(preferred));
  while (used.has(id)) id += 1;
  return id;
}

/** Nova âncora com defaults válidos (canto, tolerância, required e página). */
export function makeAnchor(params: {
  id: string;
  type: 'aruco' | 'quad';
  arucoId?: number;
  size: number;
  page?: number;
  anchors: CustomAnchor[];
}): CustomAnchor {
  const page = params.page ?? 0;
  const placement = nextAnchorPlacement(params.anchors, page);
  return {
    id: params.id,
    type: params.type,
    corner: placement.corner,
    aruco_id:
      params.type === 'aruco'
        ? nextArucoId(params.anchors, page, params.arucoId ?? 0)
        : null,
    page,
    x: placement.x,
    y: placement.y,
    size: Math.max(0.01, Math.min(0.2, params.size)),
    tolerance: 0.15,
    required: true,
  };
}
