declare module 'mammoth/mammoth.browser' {
  interface MammothImage {
    contentType: string;
    read(encoding: 'base64'): Promise<string>;
    read(): Promise<Uint8Array>;
  }
  const mammoth: {
    convertToHtml(
      input: { arrayBuffer: ArrayBuffer },
      options?: Record<string, unknown>,
    ): Promise<{ value: string; messages: { type: string; message: string }[] }>;
    images: {
      imgElement(fn: (image: MammothImage) => Promise<{ src: string; alt?: string }>): unknown;
    };
  };
  export default mammoth;
}
