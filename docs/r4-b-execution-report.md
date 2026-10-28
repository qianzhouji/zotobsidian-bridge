# R4-B Execution Report: Image Resources

Date: 2026-10-28

Status: **Implementation, deterministic acceptance, and live R4-B acceptance
passed in the isolated desktop setup.** The embedded-image path from a native
Zotero note through the Obsidian companion passed, including image rendering, a
deferred update while the card was open, queue drain after closing it, an
identical replay, and visual verification of a copied paper folder. The real
PDF image-annotation path and offline request recovery also passed. The two
follow-up acceptance issues are now resolved: Zotero's timeout notification is
a modeless status window that updates and closes after late completion, and a
duplicate `Paper.md` fixture was moved out of the active output tree so source
reconciliation has one unambiguous paper overview. The affected image
annotation refreshed successfully after the fixture correction. Disabling the
companion did not affect the local image; re-enabling it restored the connected
status. No test data was written to the daily Zotero profile; the live Zotero
instance used `.scaffold/profile` and `.scaffold/data`, and the companion was
installed only in `.scaffold/test-vault`.

## Delivered

- Exports Zotero image and ink annotation cache bytes. If the cache is missing,
  the add-on asks `Zotero.PDFWorker.renderAttachmentAnnotations()` to render the
  attachment annotations, then fails with an explicit error if the cache is
  still unavailable.
- Imports native Zotero note images from embedded-image child attachments or
  base64 image data URIs. Unavailable or unsupported image sources remain an
  explicit warning in the Markdown source block; remote image URLs are never
  fetched.
- Accepts PNG, JPEG, GIF, WebP, and BMP up to 20 MiB. The source and Obsidian
  companion validate file signature, decoded dimensions, MIME type, size, and
  SHA-256 before a resource is reported as applied.
- Stores immutable, content-addressed assets beside each card under `assets/`
  and references them with relative Markdown paths. Re-importing identical
  bytes reuses the same resource. Changed content receives a new hash filename;
  old assets are not removed automatically because another note may still link
  to them.
- Adds companion protocol v2 `create-resource` requests with a binary sidecar
  in `payloads/`. The asset is verified and written before Zotero updates the
  Markdown source block. The resource operation is create-only, scoped to the
  paired Vault and output folder, and cannot overwrite or delete an existing
  file. ACK collection removes the sidecar after Zotero consumes the response.
- Includes the image hash in the managed source hash so Zotero image changes
  trigger a source-block refresh. User-owned Markdown outside the managed source
  block remains protected by the existing update path.

## Deterministic Acceptance

| Case                                                                    | Result | Evidence                                                                                                      |
| ----------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| Raster format signatures, unsupported bytes, and 20 MiB limit           | PASS   | `npm run test:image-resource`                                                                                 |
| Image decoder success, resource cleanup, and decoder failure            | PASS   | Decoder fixture in `npm run test:image-resource`; rejection before Vault write in `npm run test:companion-r3` |
| Native-note image path mapping and explicit warning fallback            | PASS   | `npm run test:image-resource` and `npm run test:native-note`                                                  |
| Resource request fields, path, MIME, hash, and size validation          | PASS   | `npm run test:companion-protocol`                                                                             |
| Companion binary write, byte-for-byte persistence, and identical replay | PASS   | `npm run test:companion-r3`; only one hash-addressed file remains                                             |
| Corrupt payload and valid-signature-but-undecodable payload             | PASS   | `npm run test:companion-r3`; conflict response, original resource unchanged                                   |
| Resource payload cleanup after ACK                                      | PASS   | `npm run test:companion-r3`; request, response, ACK, and payload queue drain                                  |
| Zotero add-on and Obsidian companion builds                             | PASS   | `npm run build`; `npm run build:obsidian`                                                                     |
| Formatting and lint of R4-B implementation/test files                   | PASS   | Focused Prettier and ESLint checks                                                                            |

## Live Acceptance

| Case                                                      | Status | Evidence / remaining work                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native Zotero note with embedded-image child attachment   | PASS   | Isolated Zotero process 34823; note `T2W7CC8X`, child `IB8KJ3ZM`; actual Zotero menu import created one card in `.scaffold/test-vault`; 160×90 PNG rendered in Obsidian Reading View with alt text `R4-B PNG fixture`                                                                                                                                                                                                                                                                        |
| Changed image while the card was open                     | PASS   | New SHA-256 `aa0bc9819627a4ccb16852336ae3454d6bdfa7d07c0bac275accd22421ce67d1`; resource arrived first, Markdown replacement waited while the card was open, then completed after closing it. Queue drained; card ID remained `8c3c579e-3205-4884-95b6-73667b6b4058`                                                                                                                                                                                                                         |
| Identical re-import                                       | PASS   | Replayed through the registered Zotero menu callback; the existing card and content-addressed resource were reused. Exactly one Markdown card exists for `T2W7CC8X`; no request/response/ACK/payload entries remain. The prior image version is retained intentionally                                                                                                                                                                                                                       |
| Companion disabled and re-enabled                         | PASS   | With the copied card open, disabled the companion only in `.scaffold/test-vault`; the locally linked image remained visible. Re-enabled it and verified the status returned to `Zotero Bridge: connected`. No in-flight request was part of this check.                                                                                                                                                                                                                                      |
| Real image/ink PDF annotation export                      | PASS   | Isolated Zotero created image annotation `UF3R8P7Y` on page label `2` / zero-based index `1`. Card and 1593×86 PNG were written under the matching paper folder; the hash-addressed asset rendered in Obsidian Reading View.                                                                                                                                                                                                                                                                 |
| Obsidian restart while offline, then reconnect            | PASS   | After a full Obsidian exit, Zotero queued `create-resource` request `c8be606c-1455-4652-bafa-174effbde0f5`; restart retained the image card and asset and drained the request. A text-only `replace` request `c33ae975-0d16-45f8-bae2-9ac569e0a1ac` also recovered after restart; its source task completed, original card hash/content remained unchanged, and the companion queue drained. The timeout was surfaced in the modeless pending-status window, which completed after recovery. |
| Late companion ACK after timeout                          | PASS   | Closed only the test Vault to make Obsidian unavailable, invoked the annotation action, and verified a modeless pending-status window appeared after timeout. Zotero's main window remained usable. Reopening the test Vault drained the request; the status window completed and closed without a blocking alert.                                                                                                                                                                           |
| Image-annotation source reconciliation                    | PASS   | The duplicate `Paper.md` with key `user:0/68Z229Q9` was moved byte-for-byte to `.scaffold/test-vault/.bridge-fixture-archive/`, outside the active output tree. A later source refresh for `UF3R8P7Y` completed (`sync-tasks.json`: `done`); its card retained the existing identity and image, and the queue drained.                                                                                                                                                                       |
| Copy complete paper folder to a disposable Vault location | PASS   | Copied the paper directory and both assets under `.scaffold/test-vault/R4-B-Copy-Test`; verified matching bytes/hash and opened the copied card in Reading View. Its relative image rendered visibly.                                                                                                                                                                                                                                                                                        |
| Missing/corrupt image failures                            | PASS   | Deterministic decoder, malformed payload, and resource integrity rejection checks passed; a failed decode does not produce an applied resource response                                                                                                                                                                                                                                                                                                                                      |

The image decoder now uses the host window/document environment available to
Zotero and Obsidian, including DOM image decoding when `createImageBitmap` is
unavailable. A regression-test failure exposed that the R3 fake Obsidian app
did not model `workspace.containerEl.ownerDocument.defaultView`; the test shim
now mirrors that host API and the full R3/R4-B companion checks pass. R4-C
remains out of scope for this report.

## Verification Commands

```sh
npm run build
npm run build:obsidian
npm run test:image-resource
npm run test:companion-protocol
npm run test:companion-r3
npm run test:native-note
```
