import { describe, expect, it } from "vitest";
import { detectFileType, readUpload, storeUpload, validateUpload } from "../app/lib/uploads.server";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypisom"), 0, 0, 0, 0]);
const MOV = new Uint8Array([0, 0, 0, 0x14, ...Buffer.from("ftypqt  "), 0, 0, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);

const file = (bytes: Uint8Array, name: string, type: string) => new File([new Uint8Array(bytes)], name, { type });

describe("detectFileType", () => {
  it("recognises allowed formats from magic bytes", () => {
    expect(detectFileType(PNG)?.mime).toBe("image/png");
    expect(detectFileType(JPEG)?.mime).toBe("image/jpeg");
    expect(detectFileType(MP4)?.mime).toBe("video/mp4");
    expect(detectFileType(MOV)?.mime).toBe("video/quicktime");
  });
  it("rejects SVG, HTML and executables", () => {
    expect(detectFileType(SVG)).toBeNull();
    expect(detectFileType(HTML)).toBeNull();
    expect(detectFileType(EXE)).toBeNull();
  });
});

describe("validateUpload", () => {
  it("treats an empty field as no file", async () => {
    expect(await validateUpload(null, "image")).toEqual({ ok: true, file: null });
    expect(await validateUpload(file(new Uint8Array(), "", "application/octet-stream"), "image")).toEqual({ ok: true, file: null });
  });

  it("rejects an HTML file renamed to .png with a spoofed MIME type", async () => {
    const result = await validateUpload(file(HTML, "screenshot.png", "image/png"), "image");
    expect(result.ok).toBe(false);
  });

  it("rejects an SVG screenshot (XSS vector)", async () => {
    const result = await validateUpload(file(SVG, "x.svg", "image/svg+xml"), "image");
    expect(result.ok).toBe(false);
  });

  it("rejects a video uploaded in the screenshot field", async () => {
    const result = await validateUpload(file(MP4, "clip.mp4", "video/mp4"), "image");
    expect(result.ok).toBe(false);
  });

  it("rejects oversized files", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    const result = await validateUpload(file(big, "big.png", "image/png"), "image");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("too large") });
  });

  it("accepts a real PNG, sanitises the name and hashes it", async () => {
    const result = await validateUpload(file(PNG, "../../etc/pass<wd>.png", "image/png"), "image");
    expect(result.ok).toBe(true);
    if (result.ok && result.file) {
      expect(result.file.originalName).toBe("etcpasswd.png");
      expect(result.file.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe("private storage", () => {
  it("stores with a random key and reads it back", async () => {
    const result = await validateUpload(file(PNG, "a.png", "image/png"), "image");
    if (!result.ok || !result.file) throw new Error("expected file");
    const key = await storeUpload(result.file);
    expect(key).toMatch(/^[a-f0-9-]{36}\.png$/);
    expect(new Uint8Array(await readUpload(key))).toEqual(PNG);
  });

  it("refuses path traversal storage keys", async () => {
    await expect(readUpload("../../.env")).rejects.toThrow("Invalid storage key");
    await expect(readUpload("../prisma/dev.sqlite")).rejects.toThrow("Invalid storage key");
  });
});
