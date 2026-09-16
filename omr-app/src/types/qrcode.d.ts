declare module 'qrcode' {
  function toString(text: string, options?: {
    type?: 'svg' | 'terminal' | 'utf8';
    width?: number;
    margin?: number;
    color?: { dark?: string; light?: string };
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  }): Promise<string>;

  function toDataURL(text: string, options?: Record<string, unknown>): Promise<string>;

  export { toString, toDataURL };
}
