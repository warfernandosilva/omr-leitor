declare module 'js-aruco2' {
  export const AR: {
    DICTIONARIES: Record<string, unknown>;
    Dictionary: new (name: string) => unknown;
    Marker: new (corners: Array<{ x: number; y: number }>, id: number) => unknown;
    Detector: new (opts: { dictionaryName: string }) => {
      detect: (data: Uint8ClampedArray, w: number, h: number) => Array<{
        id: number;
        corners: Array<{ x: number; y: number }>;
      }>;
    };
  };
}
