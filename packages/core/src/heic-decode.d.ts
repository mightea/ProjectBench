declare module 'heic-decode' {
  interface DecodedImage {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }
  interface LazyImage {
    width: number;
    height: number;
    decode(): Promise<DecodedImage>;
  }
  interface HeicInput {
    buffer: Uint8Array;
  }
  function decode(input: HeicInput): Promise<DecodedImage>;
  namespace decode {
    function all(input: HeicInput): Promise<LazyImage[] & { dispose(): void }>;
  }
  export = decode;
}
