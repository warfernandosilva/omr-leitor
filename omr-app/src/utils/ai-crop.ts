/**
 * Recorte da região da questão para o assistente local.
 *
 * As caixas são normalizadas (0..1) sobre a imagem retificada — o mesmo espaço
 * usado pelo overlay da revisão. O recorte mantém só as bolhas da questão,
 * nunca o cartão inteiro (privacidade + menos pixels para o modelo).
 */

export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Une as caixas e aplica uma margem proporcional (padrão 15%). */
export function unionBox(boxes: NormBox[], padding = 0.15): NormBox | null {
  const valid = boxes.filter((b) => Number.isFinite(b.x) && Number.isFinite(b.y)
    && Number.isFinite(b.w) && Number.isFinite(b.h) && b.w > 0 && b.h > 0);
  if (!valid.length) return null;
  let x0 = 1;
  let y0 = 1;
  let x1 = 0;
  let y1 = 0;
  for (const b of valid) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  const padX = (x1 - x0) * padding + 0.005;
  const padY = (y1 - y0) * padding + 0.005;
  const nx0 = clamp01(x0 - padX);
  const ny0 = clamp01(y0 - padY);
  const nx1 = clamp01(x1 + padX);
  const ny1 = clamp01(y1 + padY);
  return { x: nx0, y: ny0, w: Math.max(0.001, nx1 - nx0), h: Math.max(0.001, ny1 - ny0) };
}

/**
 * Recorta a união das caixas da imagem e devolve um JPEG pequeno (data URL).
 * `maxWidth` limita o lado maior para o modelo local processar rápido.
 */
export function cropRegions(
  dataUrl: string,
  boxes: NormBox[],
  maxWidth = 640,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const box = unionBox(boxes);
    if (!box) {
      reject(new Error('Não há regiões para recortar.'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const sx = box.x * img.width;
        const sy = box.y * img.height;
        const sw = Math.max(1, box.w * img.width);
        const sh = Math.max(1, box.h * img.height);
        const scale = Math.min(1, maxWidth / Math.max(sw, sh));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sw * scale));
        canvas.height = Math.max(1, Math.round(sh * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas indisponível para recortar a imagem.'));
          return;
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Falha ao recortar a imagem.'));
      }
    };
    img.onerror = () => reject(new Error('Falha ao carregar a imagem retificada.'));
    img.src = dataUrl;
  });
}

/** Tamanho da folha depois de limitar o lado maior (nunca amplia). */
export function scaledSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Compacta a folha inteira (data URL) para o modelo ler as respostas.
 * 1600 px no lado maior mantém a linha da questão legível; JPEG q0.8
 * fica em ~300 KB, bem abaixo do limite de 4 MB do backend.
 */
export function compressSheet(
  dataUrl: string,
  maxSide = 1600,
  quality = 0.8,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = scaledSize(img.width, img.height, maxSide);
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas indisponível para compactar a imagem.'));
          return;
        }
        ctx.drawImage(img, 0, 0, size.width, size.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Falha ao compactar a imagem.'));
      }
    };
    img.onerror = () => reject(new Error('Falha ao carregar a imagem retificada.'));
    img.src = dataUrl;
  });
}
