import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  assertImageDecodable,
  detectImageFormat,
  MAX_IMAGE_RESOURCE_BYTES,
} from "../src/core/image-resource.ts";
import { convertZoteroNoteHTML } from "../src/core/zotero-note-markdown.ts";
import { decodeImageDataURI } from "../src/services/image-assets.ts";

const png = Uint8Array.from(
  globalThis.atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1sAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);
assert.deepEqual(detectImageFormat(png), {
  mimeType: "image/png",
  extension: "png",
});
const originalCreateImageBitmap = globalThis.createImageBitmap;
const originalImageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "Image",
);
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "document",
);
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "window",
);
const originalZoteroDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "Zotero",
);
const originalCreateObjectURL = globalThis.URL.createObjectURL;
const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
let bitmapClosed = false;
globalThis.createImageBitmap = async () => ({
  width: 1,
  height: 1,
  close() {
    bitmapClosed = true;
  },
});
await assertImageDecodable(png, detectImageFormat(png));
assert.equal(bitmapClosed, true);
globalThis.createImageBitmap = async () => {
  throw new Error("decode failure");
};
await assert.rejects(
  assertImageDecodable(png, detectImageFormat(png)),
  /cannot be decoded/,
);
delete globalThis.createImageBitmap;
let imageUrlRevoked = false;
globalThis.URL.createObjectURL = () => "blob:test-image-resource";
globalThis.URL.revokeObjectURL = () => {
  imageUrlRevoked = true;
};
globalThis.Image = class {
  naturalWidth = 1;
  naturalHeight = 1;
  onload = null;
  onerror = null;
  async decode() {}
  set src(_value) {}
};
await assertImageDecodable(png, detectImageFormat(png));
assert.equal(imageUrlRevoked, true);
delete globalThis.Image;
globalThis.document = {
  createElement(name) {
    assert.equal(name, "img");
    return {
      naturalWidth: 1,
      naturalHeight: 1,
      onload: null,
      onerror: null,
      async decode() {},
      set src(_value) {},
    };
  },
};
await assertImageDecodable(png, detectImageFormat(png));
globalThis.window = {
  document: {
    createElement(name) {
      assert.equal(name, "img");
      return {
        naturalWidth: 1,
        naturalHeight: 1,
        onload: null,
        onerror: null,
        async decode() {},
        set src(_value) {},
      };
    },
  },
  URL: {
    createObjectURL: () => "blob:test-window-image-resource",
    revokeObjectURL() {},
  },
};
delete globalThis.document;
await assertImageDecodable(png, detectImageFormat(png));
await assertImageDecodable(png, detectImageFormat(png), {
  document: {
    createElement(name) {
      assert.equal(name, "img");
      return {
        naturalWidth: 1,
        naturalHeight: 1,
        onload: null,
        onerror: null,
        async decode() {},
        set src(_value) {},
      };
    },
  },
  URL: {
    createObjectURL: () => "blob:test-explicit-image-environment",
    revokeObjectURL() {},
  },
});
globalThis.Zotero = {
  getMainWindow: () => ({
    document: {
      createElement(name) {
        assert.equal(name, "img");
        return {
          naturalWidth: 1,
          naturalHeight: 1,
          onload: null,
          onerror: null,
          async decode() {},
          set src(_value) {},
        };
      },
    },
    URL: {
      createObjectURL: () => "blob:test-zotero-image-resource",
      revokeObjectURL() {},
    },
  }),
};
delete globalThis.document;
delete globalThis.window;
await assertImageDecodable(png, detectImageFormat(png));
delete globalThis.Zotero;
globalThis.document = {
  createElement() {
    return {
      naturalWidth: 0,
      naturalHeight: 0,
      onload: null,
      onerror: null,
      async decode() {
        throw new Error("invalid image");
      },
      set src(_value) {},
    };
  },
};
await assert.rejects(
  assertImageDecodable(png, detectImageFormat(png)),
  /cannot be decoded/,
);
globalThis.Image = class {
  naturalWidth = 0;
  naturalHeight = 0;
  onload = null;
  onerror = null;
  async decode() {
    throw new Error("invalid image");
  }
  set src(_value) {}
};
await assert.rejects(
  assertImageDecodable(png, detectImageFormat(png)),
  /cannot be decoded/,
);
globalThis.URL.createObjectURL = originalCreateObjectURL;
globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
if (originalImageDescriptor) {
  Object.defineProperty(globalThis, "Image", originalImageDescriptor);
} else {
  delete globalThis.Image;
}
if (originalDocumentDescriptor) {
  Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
} else {
  delete globalThis.document;
}
if (originalWindowDescriptor) {
  Object.defineProperty(globalThis, "window", originalWindowDescriptor);
} else {
  delete globalThis.window;
}
if (originalZoteroDescriptor) {
  Object.defineProperty(globalThis, "Zotero", originalZoteroDescriptor);
} else {
  delete globalThis.Zotero;
}
if (originalCreateImageBitmap === undefined) {
  delete globalThis.createImageBitmap;
} else {
  globalThis.createImageBitmap = originalCreateImageBitmap;
}
assert.throws(
  () => detectImageFormat(new Uint8Array([0, 1, 2])),
  /Unsupported/,
);
const oversized = new Uint8Array(MAX_IMAGE_RESOURCE_BYTES + 1);
oversized.set(png.subarray(0, 8));
assert.throws(() => detectImageFormat(oversized), /20 MiB/);
assert.deepEqual(
  decodeImageDataURI(
    `data:image/png;base64,${globalThis.btoa(String.fromCharCode(...png))}`,
  ),
  png,
);
assert.throws(
  () =>
    decodeImageDataURI(
      `data:image/png;base64,${"A".repeat(Math.ceil(MAX_IMAGE_RESOURCE_BYTES / 3) * 4 + 4)}`,
    ),
  /20 MiB/,
);

const noteHTML =
  '<p>Figure <img data-attachment-key="IMG001" alt="model diagram"></p><img src="https://example.invalid/not-imported.png">';
const conversion = convertZoteroNoteHTML(
  noteHTML,
  parseHTML(`<html><body>${noteHTML}</body></html>`).document,
  new Map([["IMG001", "assets/IMG001-abc.png"]]),
);
assert.match(
  conversion.markdown,
  /!\[model diagram\]\(assets\/IMG001-abc\.png\)/,
);
assert.match(conversion.markdown, /Image not imported: embedded image/);
assert.equal(conversion.warnings.length, 1);

globalThis.process.stdout.write(
  "Image resource checks passed: raster signature and size validation, embedded note image links, and explicit unsupported-image warnings.\n",
);
