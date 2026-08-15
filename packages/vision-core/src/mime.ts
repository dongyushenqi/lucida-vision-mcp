/**
 * MIME 校验与 payload sniffing（规格四.1 强制安全职责）。
 *
 * - 声明 MIME 必须与实际 payload 格式一致（sniff 校验），不一致 → SECURITY_MIME_MISMATCH。
 * - 非图像 payload → VISION_INVALID_IMAGE_INPUT。
 */
export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/avif",
  "image/tiff",
] as const;

const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/x-png": "image/png",
};

/** 规范化声明 MIME：小写、去参数、别名归一。 */
export function normalizeMimeType(declared: string): string {
  const base = declared.toLowerCase().split(";")[0]?.trim() ?? "";
  return MIME_ALIASES[base] ?? base;
}

/** 魔数嗅探真实格式。 */
export function sniffMimeType(bytes: Uint8Array): string | undefined {
  const b = bytes;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF: GIF87a / GIF89a
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 &&
      b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) {
    return "image/gif";
  }
  // WebP: RIFF .... WEBP
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  // BMP: BM
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) {
    return "image/bmp";
  }
  // AVIF: .... ftyp avif / avis
  if (
    b.length >= 12 &&
    b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 &&
    ((b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x66) ||
     (b[8] === 0x61 && b[9] === 0x76 && b[10] === 0x69 && b[11] === 0x73))
  ) {
    return "image/avif";
  }
  // TIFF: II*\0 / MM\0*
  if (
    b.length >= 4 &&
    ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00) ||
     (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a))
  ) {
    return "image/tiff";
  }
  return undefined;
}
