// ─── Detecção de marcadores ArUco DICT_4X4_50 (IDs 0-3) ───

import * as jsAruco2Module from 'js-aruco2';

interface ArUcoDetector {
  detect: (imageData: { data: Uint8ClampedArray; width: number; height: number }) =>
    Array<{ id: number; corners: Array<{ x: number; y: number }> }>;
}

// js-aruco2 é CJS; em contexto ESM o default contém o módulo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsAruco2 = (jsAruco2Module as any).default ?? jsAruco2Module;
const AR = jsAruco2.AR as {
  Detector: new (opts: { dictionaryName: string }) => ArUcoDetector;
};

let detectorInstance: ArUcoDetector | null = null;

function getDetector(): ArUcoDetector {
  if (detectorInstance) return detectorInstance;
  detectorInstance = new AR.Detector({ dictionaryName: 'DICT_4X4_50' });
  return detectorInstance;
}

export interface ArUcoMarker {
  id: number;
  corners: Array<{ x: number; y: number }>;
  center: { x: number; y: number };
}

export interface ArUcoDetectionResult {
  markers: ArUcoMarker[];
  found: number[];
  missing: number[];
}

const REQUIRED_IDS = [0, 1, 2, 3];

/**
 * Detecta marcadores ArUco DICT_4X4_50 (IDs 0-3) na imagem RGBA.
 */
export function detectArUcoMarkers(
  data: Uint8ClampedArray, w: number, h: number
): ArUcoDetectionResult | null {
  const detector = getDetector();

  const raw = detector.detect({ data, width: w, height: h });
  if (!raw || raw.length === 0) {
    return { markers: [], found: [], missing: [...REQUIRED_IDS] };
  }

  const markers: ArUcoMarker[] = [];
  for (const m of raw) {
    if (REQUIRED_IDS.includes(m.id)) {
      const cx = m.corners.reduce((s: number, c: { x: number; y: number }) => s + c.x, 0) / m.corners.length;
      const cy = m.corners.reduce((s: number, c: { x: number; y: number }) => s + c.y, 0) / m.corners.length;
      markers.push({ id: m.id, corners: m.corners, center: { x: cx, y: cy } });
    }
  }

  const found = markers.map(m => m.id);
  const missing = REQUIRED_IDS.filter(id => !found.includes(id));

  return { markers, found, missing };
}

/**
 * Valida geometria dos 4 ArUco: convexidade, proporção, tamanho mínimo.
 */
export function validateArUcoGeometry(
  markers: ArUcoMarker[], imgW: number, imgH: number
): boolean {
  if (markers.length < 4) return false;

  const byId: Record<number, ArUcoMarker> = {};
  for (const m of markers) byId[m.id] = m;

  const tl = byId[0], tr = byId[1], br = byId[2], bl = byId[3];
  if (!tl || !tr || !br || !bl) return false;

  const quad = [tl.center, tr.center, br.center, bl.center];

  const topW = Math.hypot(tr.center.x - tl.center.x, tr.center.y - tl.center.y);
  const leftH = Math.hypot(bl.center.x - tl.center.x, bl.center.y - tl.center.y);
  const minDim = Math.min(imgW, imgH);
  if (topW < 0.10 * minDim || leftH < 0.10 * minDim) return false;

  const avgH = (leftH + Math.hypot(br.center.x - tr.center.x, br.center.y - tr.center.y)) / 2;
  const aspect = topW / (avgH || 1);
  if (aspect < 0.3 || aspect > 1.4) return false;

  const signs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const c = quad[(i + 2) % 4];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    signs.push(Math.sign(cr));
  }
  const nonZero = signs.filter(s => s !== 0);
  if (nonZero.length > 0 && new Set(nonZero).size > 1) return false;

  const allX = [tl.center.x, tr.center.x, br.center.x, bl.center.x];
  const allY = [tl.center.y, tr.center.y, br.center.y, bl.center.y];
  if (tl.center.x > tr.center.x) return false;
  if (tl.center.y > bl.center.y) return false;
  if (br.center.x < bl.center.x) return false;
  if (br.center.y < tr.center.y) return false;
  if (Math.min(...allX) < 0 || Math.max(...allX) > imgW) return false;
  if (Math.min(...allY) < 0 || Math.max(...allY) > imgH) return false;

  return true;
}
