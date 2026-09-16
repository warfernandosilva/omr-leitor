declare module 'jsqr' {
  function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: { inversionAttempts?: string }
  ): { data: string; location: Record<string, { x: number; y: number }> } | null;

  export default jsQR;
}
