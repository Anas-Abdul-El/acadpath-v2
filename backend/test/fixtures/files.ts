/** The first bytes of each supported type, padded: enough for signature detection. */
export const fileBytes = {
  pdf: () => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64)]),
  png: () =>
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]),
  jpeg: () =>
    Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]),
  webp: () =>
    Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBP'),
      Buffer.alloc(64),
    ]),
  exe: () => Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]),
};
