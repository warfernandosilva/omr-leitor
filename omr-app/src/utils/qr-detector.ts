// ─── Detecção de QR Code — wrapper sobre jsqr ───
// Especificação §6-8: detecta QR Code, decodifica payload, valida modelo/versão.
// Se QR não detectado → fallback para template selecionado pelo usuário.

// jsqr é CJS; em contexto ESM o default contém a função.
import jsQRModule from 'jsqr';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsQR = (jsQRModule as any)?.default ?? jsQRModule;
import { QR_MODEL, QR_VERSION } from './card-template';

export interface QRDecodeResult {
  payload: string;
  model: string;
  version: number;
  valid: boolean;
  error?: string;
}

/**
 * Detecta e decodifica o QR Code na imagem RGBA.
 *
 * @param data - pixels RGBA (Uint8ClampedArray)
 * @param w - largura da imagem
 * @param h - altura da imagem
 * @returns payload decodificado e validado, ou null se não encontrado
 */
export function detectQRCode(
  data: Uint8ClampedArray, w: number, h: number
): QRDecodeResult | null {
  const code = jsQR(data as unknown as Uint8ClampedArray, w, h);
  if (!code || !code.data) return null;

  return parseQRPayload(code.data);
}

/**
 * Decodifica e valida o payload do QR Code.
 * Formato compacto: OMR|MODEL=GABARITO_01|VERSION=2
 * Ou JSON: { "type": "OMR", "model": "GABARITO_01", "version": 2 }
 */
export function parseQRPayload(raw: string): QRDecodeResult {
  const trimmed = raw.trim();

  // Tentar formato compacto: OMR|MODEL=...|VERSION=...
  const compactMatch = trimmed.match(/^OMR\|MODEL=([A-Z0-9_]+)\|VERSION=(\d+)$/);
  if (compactMatch) {
    const model = compactMatch[1];
    const version = parseInt(compactMatch[2], 10);
    return {
      payload: trimmed,
      model,
      version,
      valid: true,
    };
  }

  // Tentar formato JSON
  try {
    const json = JSON.parse(trimmed);
    if (json.type === 'OMR' && typeof json.model === 'string' && typeof json.version === 'number') {
      return {
        payload: trimmed,
        model: json.model,
        version: json.version,
        valid: true,
      };
    }
  } catch {
    // não é JSON
  }

  // Payload desconhecido
  return {
    payload: trimmed,
    model: '',
    version: 0,
    valid: false,
    error: `Payload QR desconhecido: "${trimmed.substring(0, 50)}"`,
  };
}

/**
 * Valida se o payload do QR é o esperado para este cartão.
 */
export function validateQRPayload(result: QRDecodeResult): { ok: boolean; error?: string } {
  if (!result.valid) {
    return { ok: false, error: result.error };
  }
  if (result.model !== QR_MODEL) {
    return { ok: false, error: `Modelo incompatível: "${result.model}" (esperado "${QR_MODEL}")` };
  }
  if (result.version !== QR_VERSION) {
    return { ok: false, error: `Versão incompatível: v${result.version} (esperado v${QR_VERSION})` };
  }
  return { ok: true };
}
