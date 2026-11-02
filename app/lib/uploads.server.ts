import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { UPLOAD_LIMITS } from "./constants";

export type AttachmentKind = "image" | "video";

export interface DetectedType {
  kind: AttachmentKind;
  mime: string;
  ext: string;
}

export function detectFileType(bytes: Uint8Array): DetectedType | null {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));

  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { kind: "image", mime: "image/png", ext: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { kind: "image", mime: "image/jpeg", ext: "jpg" };
  }
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { kind: "image", mime: "image/webp", ext: "webp" };
  }
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "qt  ") return { kind: "video", mime: "video/quicktime", ext: "mov" };
    if (/^(isom|iso2|iso4|iso5|iso6|mp41|mp42|avc1|M4V |MSNV|dash)$/.test(brand)) {
      return { kind: "video", mime: "video/mp4", ext: "mp4" };
    }
    return null;
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { kind: "video", mime: "video/webm", ext: "webm" };
  }
  return null;
}

export interface ValidatedUpload {
  kind: AttachmentKind;
  mime: string;
  ext: string;
  bytes: Uint8Array;
  originalName: string;
  sha256: string;
}

export type UploadValidation =
  | { ok: true; file: ValidatedUpload | null }
  | { ok: false; error: string };

function safeOriginalName(name: string, ext: string): string {
  const base = name.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 80);
  return `${base || "upload"}.${ext}`;
}

export async function validateUpload(
  value: FormDataEntryValue | null,
  expected: AttachmentKind,
): Promise<UploadValidation> {
  if (value === null || typeof value === "string" || value.size === 0) {
    return { ok: true, file: null };
  }

  const max = expected === "image" ? UPLOAD_LIMITS.imageMaxBytes : UPLOAD_LIMITS.videoMaxBytes;
  if (value.size > max) {
    return { ok: false, error: `File is too large. Maximum size is ${Math.round(max / 1024 / 1024)} MB.` };
  }

  const bytes = new Uint8Array(await value.arrayBuffer());
  const detected = detectFileType(bytes);
  if (!detected || detected.kind !== expected) {
    return {
      ok: false,
      error:
        expected === "image"
          ? "Screenshots must be PNG, JPG or WebP images."
          : "Videos must be MP4, MOV or WebM files.",
    };
  }

  return {
    ok: true,
    file: {
      ...detected,
      bytes,
      originalName: safeOriginalName(value.name || "upload", detected.ext),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}

export function uploadDir(): string {
  return path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "storage", "uploads"));
}

function resolveKey(storageKey: string): string {
  if (!/^[a-f0-9-]{36}\.(png|jpg|webp|mp4|mov|webm)$/.test(storageKey)) {
    throw new Error("Invalid storage key");
  }
  return path.join(uploadDir(), storageKey);
}

export async function storeUpload(file: ValidatedUpload): Promise<string> {
  const storageKey = `${randomUUID()}.${file.ext}`;
  await mkdir(uploadDir(), { recursive: true, mode: 0o700 });
  await writeFile(resolveKey(storageKey), file.bytes, { mode: 0o600, flag: "wx" });
  return storageKey;
}

export async function readUpload(storageKey: string): Promise<Buffer> {
  return readFile(resolveKey(storageKey));
}

export async function deleteUpload(storageKey: string): Promise<void> {
  try {
    await unlink(resolveKey(storageKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
