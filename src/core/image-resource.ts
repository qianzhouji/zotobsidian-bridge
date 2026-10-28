export const MAX_IMAGE_RESOURCE_BYTES = 20 * 1024 * 1024;

export type SupportedImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "image/bmp";

export interface ImageFormat {
  mimeType: SupportedImageMimeType;
  extension: "png" | "jpg" | "gif" | "webp" | "bmp";
}

export interface ImageDecodeEnvironment {
  Image?: new () => HTMLImageElement;
  document?: Document;
  URL?: typeof URL & {
    createObjectURL?: (object: Blob) => string;
    revokeObjectURL?: (url: string) => void;
  };
}

const formats: ImageFormat[] = [
  { mimeType: "image/png", extension: "png" },
  { mimeType: "image/jpeg", extension: "jpg" },
  { mimeType: "image/gif", extension: "gif" },
  { mimeType: "image/webp", extension: "webp" },
  { mimeType: "image/bmp", extension: "bmp" },
];

export function detectImageFormat(bytes: Uint8Array): ImageFormat {
  const startsWith = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));

  let format: ImageFormat | undefined;
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    format = formats[0];
  } else if (startsWith(0xff, 0xd8, 0xff)) {
    format = formats[1];
  } else if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") {
    format = formats[2];
  } else if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    format = formats[3];
  } else if (ascii(0, 2) === "BM") {
    format = formats[4];
  }

  if (!format) {
    throw new Error(
      "Unsupported or invalid image data. Supported formats are PNG, JPEG, GIF, WebP, and BMP.",
    );
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_RESOURCE_BYTES) {
    throw new Error("Image data is empty or exceeds the 20 MiB export limit.");
  }
  return format;
}

export async function assertImageDecodable(
  bytes: Uint8Array,
  format: ImageFormat,
  environment?: ImageDecodeEnvironment,
): Promise<void> {
  const blob = new Blob([new Uint8Array(bytes)], { type: format.mimeType });
  const decode = (
    globalThis as typeof globalThis & {
      createImageBitmap?: (
        image: Blob,
      ) => Promise<{ width: number; height: number; close(): void }>;
    }
  ).createImageBitmap;
  if (typeof decode === "function") {
    let bitmap: { width: number; height: number; close(): void };
    try {
      bitmap = await decode(blob);
    } catch {
      throw new Error(
        "Image data has a valid file signature but cannot be decoded.",
      );
    }
    try {
      if (bitmap.width <= 0 || bitmap.height <= 0) {
        throw new Error("Decoded image has invalid dimensions.");
      }
    } finally {
      bitmap.close();
    }
    return;
  }

  const imageRuntime = globalThis as typeof globalThis &
    ImageDecodeEnvironment & {
      window?: ImageDecodeEnvironment;
      Zotero?: { getMainWindow?: () => ImageDecodeEnvironment };
    };
  const hostWindow = environment ?? imageRuntime.Zotero?.getMainWindow?.();
  const imageDocument =
    hostWindow?.document ??
    imageRuntime.document ??
    imageRuntime.window?.document ??
    undefined;
  const urlAPI =
    hostWindow?.URL ??
    imageRuntime.window?.URL ??
    imageRuntime.URL ??
    imageDocument?.defaultView?.URL;
  const createObjectURL = urlAPI?.createObjectURL;
  const revokeObjectURL = urlAPI?.revokeObjectURL;
  const ImageConstructor =
    hostWindow?.Image ??
    imageRuntime.Image ??
    imageRuntime.window?.Image ??
    imageDocument?.defaultView?.Image;
  const image =
    typeof ImageConstructor === "function"
      ? new ImageConstructor()
      : imageDocument?.createElement("img");
  if (
    typeof createObjectURL !== "function" ||
    typeof revokeObjectURL !== "function" ||
    !image
  ) {
    throw new Error(
      "This Zotero/Obsidian runtime cannot decode image resources.",
    );
  }

  const url = createObjectURL.call(urlAPI, blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const validDimensions = () =>
        image.naturalWidth > 0 && image.naturalHeight > 0;
      image.onload = () =>
        validDimensions()
          ? resolve()
          : reject(new Error("Decoded image has invalid dimensions."));
      image.onerror = () => reject(new Error("Image decoding failed."));
      image.src = url;
      if (typeof image.decode === "function") {
        void image.decode().then(
          () =>
            validDimensions()
              ? resolve()
              : reject(new Error("Decoded image has invalid dimensions.")),
          () => reject(new Error("Image decoding failed.")),
        );
      }
    });
  } catch {
    throw new Error(
      "Image data has a valid file signature but cannot be decoded.",
    );
  } finally {
    image.onload = null;
    image.onerror = null;
    revokeObjectURL.call(urlAPI, url);
  }
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const exactBytes = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", exactBytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
