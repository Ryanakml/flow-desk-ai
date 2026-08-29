import { describe, expect, it } from "vitest";
import {
  detectMimeType,
  getMediaSizeLimit,
  validateMediaAttachment,
  MEDIA_SIZE_LIMITS
} from "./media.js";

describe("Media Domain Rules & Magic-Byte Validation (M3-06)", () => {
  describe("detectMimeType", () => {
    it("identifies JPEG signature (FF D8 FF)", () => {
      const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      expect(detectMimeType(jpeg)).toBe("image/jpeg");
    });

    it("identifies PNG signature (89 50 4E 47 0D 0A 1A 0A)", () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
      expect(detectMimeType(png)).toBe("image/png");
    });

    it("identifies WEBP signature (RIFF....WEBP)", () => {
      const webp = new Uint8Array([
        0x52,
        0x49,
        0x46,
        0x46, // RIFF
        0x00,
        0x00,
        0x00,
        0x00, // file size
        0x57,
        0x45,
        0x42,
        0x50 // WEBP
      ]);
      expect(detectMimeType(webp)).toBe("image/webp");
    });

    it("identifies PDF signature (%PDF-)", () => {
      const pdf = new TextEncoder().encode("%PDF-1.7 standard header");
      expect(detectMimeType(pdf)).toBe("application/pdf");
    });

    it("identifies MP4 container signature (....ftyp)", () => {
      const mp4 = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x18, // box size
        0x66,
        0x74,
        0x79,
        0x70, // ftyp
        0x69,
        0x73,
        0x6f,
        0x6d // isom
      ]);
      expect(detectMimeType(mp4)).toBe("video/mp4");
    });

    it("identifies MP3 signature with ID3 header", () => {
      const mp3 = new TextEncoder().encode("ID3\x03\x00\x00\x00");
      expect(detectMimeType(mp3)).toBe("audio/mpeg");
    });

    it("identifies OGG container signature (OggS)", () => {
      const ogg = new TextEncoder().encode("OggS\x00\x02\x00");
      expect(detectMimeType(ogg)).toBe("audio/ogg");
    });

    it("returns null on truncated headers (< 4 bytes)", () => {
      expect(detectMimeType(new Uint8Array([0xff, 0xd8]))).toBeNull();
      expect(detectMimeType(new Uint8Array([]))).toBeNull();
    });

    it("returns null on unrecognized signatures", () => {
      const random = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
      expect(detectMimeType(random)).toBeNull();
    });
  });

  describe("getMediaSizeLimit", () => {
    it("returns 16MB for image and audio types", () => {
      expect(getMediaSizeLimit("image/jpeg")).toBe(MEDIA_SIZE_LIMITS.IMAGE_MAX_BYTES);
      expect(getMediaSizeLimit("image/png")).toBe(MEDIA_SIZE_LIMITS.IMAGE_MAX_BYTES);
      expect(getMediaSizeLimit("image/webp")).toBe(MEDIA_SIZE_LIMITS.IMAGE_MAX_BYTES);
      expect(getMediaSizeLimit("audio/ogg")).toBe(MEDIA_SIZE_LIMITS.AUDIO_MAX_BYTES);
      expect(getMediaSizeLimit("audio/mpeg")).toBe(MEDIA_SIZE_LIMITS.AUDIO_MAX_BYTES);
    });

    it("returns 100MB for video and pdf types", () => {
      expect(getMediaSizeLimit("video/mp4")).toBe(MEDIA_SIZE_LIMITS.VIDEO_MAX_BYTES);
      expect(getMediaSizeLimit("application/pdf")).toBe(MEDIA_SIZE_LIMITS.DOCUMENT_MAX_BYTES);
    });

    it("returns null for disallowed MIME types", () => {
      expect(getMediaSizeLimit("application/x-sh")).toBeNull();
      expect(getMediaSizeLimit("text/html")).toBeNull();
      expect(getMediaSizeLimit("application/zip")).toBeNull();
    });
  });

  describe("validateMediaAttachment", () => {
    const validJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const validPdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj");

    it("approves valid JPEG within size limits", () => {
      const res = validateMediaAttachment("image/jpeg", validJpeg, 50000);
      expect(res.valid).toBe(true);
      expect(res.detectedMime).toBe("image/jpeg");
      expect(res.error).toBeUndefined();
    });

    it("rejects disallowed MIME type before checking magic bytes", () => {
      const res = validateMediaAttachment("application/x-dosexec", validJpeg, 1000);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("DISALLOWED_MIME_TYPE");
    });

    it("rejects oversized file exceeding category limit", () => {
      const res = validateMediaAttachment("image/jpeg", validJpeg, 17 * 1024 * 1024);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("EXCEEDS_SIZE_LIMIT");
    });

    it("rejects spoofed MIME when declared type does not match detected magic bytes", () => {
      // Declares image/jpeg but passes PDF magic bytes
      const res = validateMediaAttachment("image/jpeg", validPdf, 1000);
      expect(res.valid).toBe(false);
      expect(res.detectedMime).toBe("application/pdf");
      expect(res.error).toContain("MIME_SPOOFED");
    });

    it("rejects file with unknown magic bytes", () => {
      const unknownBytes = new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44]);
      const res = validateMediaAttachment("image/jpeg", unknownBytes, 1000);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("UNKNOWN_MAGIC_BYTES");
    });

    it("permits audio/mp4 container with ftyp box", () => {
      const mp4Bytes = new Uint8Array([
        0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20
      ]);
      const res = validateMediaAttachment("audio/mp4", mp4Bytes, 1000);
      expect(res.valid).toBe(true);
      expect(res.detectedMime).toBe("video/mp4");
    });
  });
});
