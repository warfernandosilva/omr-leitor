import { describe, it, expect } from 'vitest';
import type { CustomAnchor } from './custom-template-api';
import { ANCHOR_CORNERS, makeAnchor, nextAnchorPlacement, nextArucoId } from './custom-template-anchor';

function anchor(over: Partial<CustomAnchor> = {}): CustomAnchor {
  return {
    id: 'anc',
    type: 'quad',
    corner: null,
    aruco_id: null,
    page: 0,
    x: 0.5,
    y: 0.5,
    size: 0.05,
    tolerance: 0.15,
    required: true,
    ...over,
  };
}

describe('adicionar âncora ao gabarito personalizado', () => {
  it('ocupa os quatro cantos na ordem TL, TR, BR, BL', () => {
    const anchors: CustomAnchor[] = [];
    for (const expected of ANCHOR_CORNERS) {
      const p = nextAnchorPlacement(anchors);
      expect(p.corner).toBe(expected);
      anchors.push(anchor({ corner: p.corner, x: p.x, y: p.y }));
    }
  });

  it('pula cantos já ocupados', () => {
    const anchors = [anchor({ corner: 'TL' }), anchor({ corner: 'BR' })];
    expect(nextAnchorPlacement(anchors).corner).toBe('TR');
    expect(nextAnchorPlacement([...anchors, anchor({ corner: 'TR' })]).corner).toBe('BL');
  });

  it('considera apenas as âncoras da página atual', () => {
    const anchors = [
      anchor({ corner: 'TL', page: 0 }),
      anchor({ corner: 'TR', page: 0 }),
      anchor({ corner: 'BR', page: 0 }),
      anchor({ corner: 'BL', page: 0 }),
    ];
    const p = nextAnchorPlacement(anchors, 1);
    expect(p.corner).toBe('TL');
    expect(p.x).toBeLessThan(0.5);
  });

  it('depois de 4, usa o centro sem canto e sem empilhar', () => {
    const anchors = Array.from({ length: 4 }, (_, i) =>
      anchor({ corner: ANCHOR_CORNERS[i], x: 0.1, y: 0.1 }));
    const p5 = nextAnchorPlacement(anchors);
    const p6 = nextAnchorPlacement([...anchors, anchor({ ...p5 })]);
    expect(p5.corner).toBeNull();
    expect([p5.x, p5.y]).not.toEqual([p6.x, p6.y]);
    expect(p5.x).toBeGreaterThan(0.2);
    expect(p5.x).toBeLessThan(0.8);
  });

  it('gera IDs ArUco livres e ignora quadrados/outras páginas', () => {
    const anchors = [
      anchor({ type: 'aruco', aruco_id: 0 }),
      anchor({ type: 'aruco', aruco_id: 2 }),
      anchor({ type: 'quad', aruco_id: null }),
      anchor({ type: 'aruco', aruco_id: 9, page: 1 }),
    ];
    expect(nextArucoId(anchors, 0, 0)).toBe(1);
    expect(nextArucoId(anchors, 0, 5)).toBe(5);
    // ID 9 existe só na página 1: não bloqueia a página 0, mas bloqueia a 1.
    expect(nextArucoId(anchors, 0, 9)).toBe(9);
    expect(nextArucoId(anchors, 1, 9)).toBe(10);
    expect(nextArucoId([], 0, 0)).toBe(0);
  });

  it('makeAnchor preenche canto, página, tolerância e limita o tamanho', () => {
    const a = makeAnchor({ id: 'novo', type: 'quad', size: 0.5, page: 0, anchors: [] });
    expect(a).toMatchObject({
      id: 'novo',
      type: 'quad',
      corner: 'TL',
      aruco_id: null,
      page: 0,
      size: 0.2,
      tolerance: 0.15,
      required: true,
    });
  });

  it('makeAnchor ArUco escolhe o próximo ID livre', () => {
    const a = makeAnchor({
      id: 'novo',
      type: 'aruco',
      arucoId: 3,
      size: 0.05,
      anchors: [anchor({ type: 'aruco', aruco_id: 3 }), anchor({ type: 'aruco', aruco_id: 4 })],
    });
    expect(a.type).toBe('aruco');
    expect(a.aruco_id).toBe(5);
  });
});
