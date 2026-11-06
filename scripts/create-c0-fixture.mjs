import fs from "node:fs/promises";
import { constants } from "node:fs";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifestName = "c-fixture-manifest.json";
const directories = [
  "c-vault",
  "c-vault/Mathematics",
  "c-vault/Physics",
  "c-vault/Cycles",
  "c-vault/assets",
  "c-queue",
];
const notes = {
  "C0 Root Demo.md": `# C0 Root Demo

Synthetic C0 test content only. This is an ordinary Markdown demo, not a
Zotero annotation card; it has no live source identity or save session.

## Knowledge links

- [[Mathematics/Bayes]]
- [[Mathematics/Bayes|Bayesian inference]]
- [[Physics/Motion]]
- [[Mathematics/Shared]] and [[Physics/Shared]] have duplicate basenames.
- [[Shared]] deliberately leaves that basename ambiguous.
- [[Cycles/A]] starts A -> B -> C -> A, with a shorter A -> B -> A cycle.
- [[Mathematics/Bayes#Posterior]]
- [[Mathematics/Bayes#Posterior#Worked example]]
- [[Mathematics/Bayes#^bayes-rule]]
- [[#Knowledge links]] returns to this heading.
- [Motion in Markdown](Physics/Motion.md)
- [[Missing C0 Note]] and [[Mathematics/Bayes#Missing heading]] are negative cases.
- ![[Physics/Motion]] is a note-embed case, not an instruction to copy a note.

## Local image

![[assets/c0-colors.png]]

## Literal text

Inline code: \`[[Not a link]]\`.

\`\`\`text
[[Not a link either]]
\`\`\`

\\[\\[Escaped text]]

%% [[Commented link]] %%
`,
  "Mathematics/Bayes.md": String.raw`---
aliases:
  - Bayesian inference
  - Bayes rule
---
# Bayes

Synthetic mathematics note; no Bridge properties are required.

## Posterior

For this test, $P(A)=0.5$, $P(B\mid A)=0.8$, and $P(B)=0.4$.

$$
P(A\mid B) = \frac{P(B\mid A)P(A)}{P(B)} = 1
$$

The posterior follows from the stated synthetic probabilities. ^bayes-rule

### Worked example

[[#Posterior]] returns to the formula. [[Shared]] tests source-folder context.
[[Physics/Motion|Motion model]] and [[Cycles/A]] continue the graph.

## Example

First occurrence of a deliberately repeated heading.

## Example

Second occurrence; a resolver must not silently guess the intended occurrence.
`,
  "Physics/Motion.md": String.raw`---
aliases:
  - Newtonian motion
  - Kinematics
---
# Motion

Synthetic physics note with inline math $F=ma$.

## Constant acceleration

$$
x(t)=x_0+v_0t+\frac{1}{2}at^2
$$

A test object starts at rest with constant acceleration. ^motion-example

[[Mathematics/Bayes]] supplies another child; [[Shared]] uses this folder.
[Bayes in Markdown](../Mathematics/Bayes.md) uses a relative path.

![Synthetic color grid](../assets/c0-colors.png)
`,
  "Mathematics/Shared.md": `# Shared

Synthetic mathematics duplicate-name target, distinct from Physics/Shared.

[[Bayes]] uses this note's own source directory.
`,
  "Physics/Shared.md": `# Shared

Synthetic physics duplicate-name target, distinct from Mathematics/Shared.

[[Motion]] uses this note's own source directory.
`,
  "Cycles/A.md": `# Cycle A

Synthetic cycle entry: [[Cycles/B]]; shared child: [[Physics/Motion]].
`,
  "Cycles/B.md": `# Cycle B

Synthetic short cycle: [[Cycles/A]]; longer cycle: [[Cycles/C]].
`,
  "Cycles/C.md": `# Cycle C

Synthetic return edge: [[Cycles/A]]; shared child: [[Physics/Motion]].
`,
};
const files = new Map(
  Object.entries(notes).map(([name, content]) => [
    `c-vault/${name}`,
    Buffer.from(content, "utf8"),
  ]),
);
// Generated 48 x 32 RGB test grid, with no external or user-data dependency.
files.set(
  "c-vault/assets/c0-colors.png",
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAAR0lEQVR4nO3PIRUAIBBEwSuEQ2BJRw2ikIEmNCDDCVDz3vc7G7v1VGfVVGXMVAEEBAQEBAQE9Bn0eiB7GAgICAgICAjoM+gCRcYIiGP22CMAAAAASUVORK5CYII=",
    "base64",
  ),
);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = Buffer.from(
  `${JSON.stringify(
    {
      fixture: "zotero-obsidian-bridge-c0",
      version: 1,
      directories,
      files: Object.fromEntries(
        [...files].map(([name, content]) => [
          name,
          { bytes: content.length, sha256: sha256(content) },
        ]),
      ),
    },
    null,
    2,
  )}\n`,
);

const usage = `Usage: node scripts/create-c0-fixture.mjs [--create | --check] [--root ABSOLUTE_DIRECTORY]

No arguments or --help: show this help without writing.
--create: create a fresh synthetic fixture, or validate an unchanged one.
--check: read-only validation of the complete baseline and SHA-256 manifest.
--root: override the parent of c-vault, c-queue and c-fixture-manifest.json;
        default is ${path.join(projectRoot, ".scaffold")}.

Use an isolated, quiescent directory with no symlink components (including
ancestors; on macOS use /private/tmp rather than /tmp). No profile, plugin,
pairing, queue request, or .obsidian configuration is created. Existing files
are never rewritten, adopted, repaired, or deleted. Changed/missing/unowned
files, unexpected entries, symlinks and hard-linked files cause refusal.
`;

async function lstatIfPresent(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

// Check every ancestor, not just the leaf: a redirected parent is also unsafe.
async function directoryChain(target, create = false) {
  const { root } = path.parse(target);
  let current = root;
  for (const part of target
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    let stat = await lstatIfPresent(current);
    if (!stat) {
      if (!create) return false;
      await fs.mkdir(current, { mode: 0o700 });
      stat = await fs.lstat(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Unsafe directory (not a real directory): ${current}`);
    }
    if ((await fs.realpath(current)) !== current) {
      throw new Error(`Non-canonical directory: ${current}`);
    }
  }
  return true;
}

async function validateFile(target, expected) {
  if (!(await directoryChain(path.dirname(target)))) {
    throw new Error(`Missing parent directory: ${target}`);
  }
  const stat = await lstatIfPresent(target);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw new Error(
      `Missing or unsafe file (symlink/hard link refused): ${target}`,
    );
  }
  const handle = await fs.open(
    target,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== stat.dev ||
      opened.ino !== stat.ino ||
      opened.size !== expected.length ||
      sha256(await handle.readFile()) !== sha256(expected)
    ) {
      throw new Error(
        `Changed file or manifest; refusing to overwrite: ${target}`,
      );
    }
  } finally {
    await handle.close();
  }
}

async function validateTree(root, relative) {
  const target = path.join(root, relative);
  if (!(await directoryChain(target))) {
    throw new Error(`Missing directory: ${target}`);
  }
  for (const name of await fs.readdir(target)) {
    const child = `${relative}/${name}`;
    if (directories.includes(child)) {
      await validateTree(root, child);
    } else if (files.has(child)) {
      await validateFile(path.join(root, child), files.get(child));
    } else {
      throw new Error(`Unowned entry; refusing to adopt or remove: ${child}`);
    }
  }
}

async function inspect(root) {
  if (!(await directoryChain(root))) return false;
  const manifestPath = path.join(root, manifestName);
  if (!(await lstatIfPresent(manifestPath))) {
    for (const name of ["c-vault", "c-queue"]) {
      if (await lstatIfPresent(path.join(root, name))) {
        throw new Error(`Unowned ${name}; ownership manifest is missing.`);
      }
    }
    return false;
  }

  // The compiled inventory is authoritative; never follow paths from disk JSON.
  await validateFile(manifestPath, manifest);
  for (const relative of directories) {
    if (!(await directoryChain(path.join(root, relative)))) {
      throw new Error(`Missing fixture directory: ${relative}`);
    }
  }
  for (const [relative, bytes] of files) {
    await validateFile(path.join(root, relative), bytes);
  }
  await validateTree(root, "c-vault");
  await validateTree(root, "c-queue");
  return true;
}

async function writeNewFile(target, content) {
  if (!(await directoryChain(path.dirname(target)))) {
    throw new Error(`Missing parent directory: ${target}`);
  }
  const handle = await fs.open(
    target,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      create: { type: "boolean" },
      check: { type: "boolean" },
      root: { type: "string" },
      help: { type: "boolean" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.create && values.check) {
    throw new Error("Choose exactly one of --create and --check.");
  }
  if (values.help || (!values.create && !values.check)) {
    process.stdout.write(usage);
    return;
  }
  if (
    constants.O_NOFOLLOW === undefined ||
    constants.O_NONBLOCK === undefined
  ) {
    throw new Error(
      "This platform lacks the required no-follow filesystem flags.",
    );
  }
  const requestedRoot = values.root ?? path.join(projectRoot, ".scaffold");
  if (!path.isAbsolute(requestedRoot)) {
    throw new Error("--root must be an absolute, isolated directory.");
  }
  const root = path.resolve(requestedRoot);
  if (root === path.parse(root).root) {
    throw new Error("The filesystem root is not a fixture directory.");
  }
  const exists = await inspect(root);
  if (!exists) {
    if (!values.create) {
      throw new Error(
        "Fixture absent; --check never writes. Use --create explicitly.",
      );
    }
    await directoryChain(root, true);
    for (const relative of directories) {
      await directoryChain(path.dirname(path.join(root, relative)));
      await fs.mkdir(path.join(root, relative), { mode: 0o700 });
    }
    for (const [relative, bytes] of files) {
      await writeNewFile(path.join(root, relative), bytes);
    }
    // Publish ownership last. An interrupted creation stays unowned and fails closed.
    await writeNewFile(path.join(root, manifestName), manifest);
    await inspect(root);
  }
  process.stdout.write(
    `${exists ? "Validated (no writes)" : "Created"}: ${root}\n` +
      `${Object.keys(notes).length} ordinary Markdown notes, 1 PNG, empty c-queue\n` +
      `Manifest SHA-256: ${sha256(manifest)}\n` +
      "Preparation only; no live C0 host gate was tested.\n",
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`C0 fixture refused: ${error.message}\n`);
  process.exitCode = 1;
}
