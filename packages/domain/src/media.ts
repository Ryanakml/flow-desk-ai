export const MEDIA_SIZE_LIMITS = {
  IMAGE_MAX_BYTES: 16 * 1024 * 1024, // 16 MB
  AUDIO_MAX_BYTES: 16 * 1024 * 1024, // 16 MB
  VIDEO_MAX_BYTES: 100 * 1024 * 1024, // 100 MB
  DOCUMENT_MAX_BYTES: 100 * 1024 * 1024 // 100 MB
} as const;

export const ALLOWED_MIME_TYPES = new Set<string>([
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  // Audio
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  // Video
  "video/mp4",
  // Documents
  "application/pdf"
]);

/**
 * Returns maximum allowed bytes for a given MIME type, or null if MIME is not allowed.
 */
export function getMediaSizeLimit(contentType: string): number | null {
  const mime = contentType.toLowerCase().trim();
  if (mime.startsWith("image/")) {
    return ALLOWED_MIME_TYPES.has(mime) ? MEDIA_SIZE_LIMITS.IMAGE_MAX_BYTES : null;
  }
  if (mime.startsWith("audio/")) {
    return ALLOWED_MIME_TYPES.has(mime) ? MEDIA_SIZE_LIMITS.AUDIO_MAX_BYTES : null;
  }
  if (mime.startsWith("video/")) {
    return ALLOWED_MIME_TYPES.has(mime) ? MEDIA_SIZE_LIMITS.VIDEO_MAX_BYTES : null;
  }
  if (mime === "application/pdf") {
    return MEDIA_SIZE_LIMITS.DOCUMENT_MAX_BYTES;
  }
  return null;
}

/**
 * Inspects header bytes of a file to determine the true MIME type (magic bytes).
 */
export function detectMimeType(header: Uint8Array): string | null {
  if (header.length < 4) return null;

  // JPEG: FF D8 FF
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return "image/png";
  }

  // WEBP: RIFF....WEBP
  if (
    header.length >= 12 &&
    header[0] === 0x52 && // R
    header[1] === 0x49 && // I
    header[2] === 0x46 && // F
    header[3] === 0x46 && // F
    header[8] === 0x57 && // W
    header[9] === 0x45 && // E
    header[10] === 0x42 && // B
    header[11] === 0x50 // P
  ) {
    return "image/webp";
  }

  // PDF: %PDF-
  if (
    header[0] === 0x25 && // %
    header[1] === 0x50 && // P
    header[2] === 0x44 && // D
    header[3] === 0x46 && // F
    header[4] === 0x2d // -
  ) {
    return "application/pdf";
  }

  // MP4 / M4A: ....ftyp
  if (
    header.length >= 8 &&
    header[4] === 0x66 && // f
    header[5] === 0x74 && // t
    header[6] === 0x79 && // y
    header[7] === 0x70 // p
  ) {
    // Both video/mp4 and audio/mp4 use ftyp
    return "video/mp4";
  }

  // MP3: ID3
  if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
    return "audio/mpeg";
  }
  // MP3 frame sync: FF FB, FF F3, FF F2
  if (header[0] === 0xff && (header[1] === 0xfb || header[1] === 0xf3 || header[1] === 0xf2)) {
    return "audio/mpeg";
  }

  // OGG: OggS
  if (
    header[0] === 0x4f && // O
    header[1] === 0x67 && // g
    header[2] === 0x67 && // g
    header[3] === 0x53 // S
  ) {
    return "audio/ogg";
  }

  return null;
}

export interface MediaValidationResult {
  valid: boolean;
  detectedMime: string | null;
  error?: string | undefined;
}

/**
 * Validates a media attachment against declared MIME, size limits, and detected magic bytes.
 */
export function validateMediaAttachment(
  declaredMime: string,
  headerBytes: Uint8Array,
  byteSize: number
): MediaValidationResult {
  const normDeclared = declaredMime.toLowerCase().trim();

  // 1. Check declared MIME in allowlist
  if (!ALLOWED_MIME_TYPES.has(normDeclared)) {
    return {
      valid: false,
      detectedMime: null,
      error: `DISALLOWED_MIME_TYPE: MIME type '${declaredMime}' is not permitted.`
    };
  }

  // 2. Check byte size limit
  const sizeLimit = getMediaSizeLimit(normDeclared);
  if (sizeLimit !== null && byteSize > sizeLimit) {
    return {
      valid: false,
      detectedMime: null,
      error: `EXCEEDS_SIZE_LIMIT: File size of ${byteSize} bytes exceeds the limit of ${sizeLimit} bytes.`
    };
  }

  // 3. Check magic bytes
  const detected = detectMimeType(headerBytes);
  if (!detected) {
    return {
      valid: false,
      detectedMime: null,
      error: `UNKNOWN_MAGIC_BYTES: File header does not match any allowed file signatures.`
    };
  }

  // For MP4 container formats, video/mp4 and audio/mp4 are compatible
  const isMp4Compatible =
    (normDeclared === "video/mp4" || normDeclared === "audio/mp4") && detected === "video/mp4";

  if (detected !== normDeclared && !isMp4Compatible) {
    return {
      valid: false,
      detectedMime: detected,
      error: `MIME_SPOOFED: Declared '${declaredMime}' but detected signature is '${detected}'.`
    };
  }

  return {
    valid: true,
    detectedMime: detected
  };
}
