# Zotero Obsidian Bridge Companion

The companion is the optional Vault-side writer for Zotero Obsidian Bridge. It
receives versioned JSON requests from a local folder and performs Markdown
creates or revision-checked updates through Obsidian's Vault API.

## Build

From the repository root, install the companion dependencies and run:

```sh
npm --prefix obsidian-plugin ci
npm run build:obsidian
```

The installable files are staged under `.scaffold/obsidian-plugin/`. Install
that folder only into a separate test Vault while developing. Do not test this
plugin in the primary knowledge Vault.

## Pairing

1. Enable the companion in Obsidian's Community plugins settings.
2. In the companion settings, set an absolute local queue folder and the same
   output-folder name used by Zotero. Copy its Vault pairing ID into Zotero.
   Use the exact same queue folder in both applications; the queue is local
   and must not be put inside the Vault.
3. In Zotero, configure the matching queue path and select the Obsidian
   companion writer mode.
4. Keep Zotero's default direct writer selected until the paired setup has
   passed manual acceptance in a disposable Vault.

The companion generates a stable pairing ID per Vault. Copy it using the
command palette action **Copy Zotero Bridge Vault pairing ID** or from the
companion settings. The status bar reports queue ownership, pending writes,
editor deferrals, unconsumed ACKs, and conflicts. Only one Obsidian instance
may consume a given queue at a time; another instance stays in observer mode
until the owner closes the plugin or application.

For deterministic development checks, run `npm run test:companion-r3`. This
builds the companion and exercises it against a disposable filesystem-backed
Vault and queue. It does not install or enable the plugin in Obsidian.

To switch writers or change either output-folder setting, first switch Zotero
to direct mode and wait until pending writes are drained. Zotero blocks the
transition while a Vault write or unanswered request is pending; the Obsidian
companion refuses queue/output setting changes while queue records remain.

If Obsidian is closed, requests remain on disk. The Zotero operation waits up
to 1.5 seconds for an acknowledgement, then reports the request as pending;
it never falls back to a direct Vault write in companion mode. Obsidian retries
deferred requests while the target file is open in an editor. If the file was
saved in the meantime, the stale request is rejected by its base revision and
the Zotero sync queue can be retried explicitly.

The protocol is local-file based, intended for one machine and one writer. It
does not make iCloud or other multi-device concurrent edits transactional.
