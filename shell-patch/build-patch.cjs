// Build the size-neutral main.js patch.
//
// Constraint: `resources/app.asar` is covered by Electron's ELECTRONASAR integrity
// resource, which hashes ONLY the asar header JSON (bytes 16..16+jsonSize), verified by
// matching 69828bdc... exactly. Entry payloads are NOT hashed. But a changed payload
// length would force header offset rewrites — so keep `lib/main.js` byte-for-byte the
// same length and nothing else in the archive needs touching.
//
// Method: 4 code edits add N bytes; one doc-comment block is rewritten so that its
// replacement is exactly (blockBytes - N) bytes. Single contiguous edit, no dangling prose.
//
// usage: node build-patch.cjs [inFile] [outFile]
//   default: ./main.orig.js -> ./main.patched.js (next to this script)
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const SRC = process.argv[2] ?? path.join(HERE, 'main.orig.js');
const DST = process.argv[3] ?? path.join(HERE, 'main.patched.js');
const original = fs.readFileSync(SRC, 'utf8');
const originalBytes = Buffer.byteLength(original, 'utf8');

const edits = [
  {
    name: 'E1 defaults',
    from: 'const defaults = { updates: { allowTestAuthPopupWindow: false } };',
    to: 'const defaults = { updates: { allowTestAuthPopupWindow: false }, closeButtonAction: "tray" };',
  },
  {
    name: 'E2 read + validate',
    from: '\t\treturn { updates: { allowTestAuthPopupWindow: allow ?? false } };',
    to:
      '\t\tconst closeAction = value.closeButtonAction;\n' +
      '\t\treturn { updates: { allowTestAuthPopupWindow: allow ?? false }, closeButtonAction: closeAction === "quit" ? "quit" : "tray" };',
  },
  {
    name: 'E3 close handler',
    from: '\t\t\tconst hide = () => {',
    to:
      '\t\t\tif (desktopSettings.closeButtonAction === "quit") {\n' +
      '\t\t\t\tapp.quit();\n' +
      '\t\t\t\treturn;\n' +
      '\t\t\t}\n' +
      '\t\t\tconst hide = () => {',
  },
  {
    name: 'E4 host env',
    from: '\t\t\tDSH_CLIENT_VERSION: desktopClientVersion()',
    to: '\t\t\tDSH_CLIENT_VERSION: desktopClientVersion(),\n\t\t\tDSH_DESKTOP_USER_DATA: app.getPath("userData")',
  },
];

let out = original;
let added = 0;
for (const e of edits) {
  const n = out.split(e.from).length - 1;
  if (n !== 1) throw new Error(`${e.name}: anchor count ${n}`);
  const delta = Buffer.byteLength(e.to, 'utf8') - Buffer.byteLength(e.from, 'utf8');
  added += delta;
  console.log(`${e.name}: +${delta}`);
  out = out.replace(e.from, () => e.to);
}
console.log('added bytes =', added);

// ---- the doc block to rewrite: the largest /** */ block in the file ----
const blocks = [];
for (const m of out.matchAll(/\/\*\*(?:[^*]|\*(?!\/))*\*\//g)) {
  blocks.push({ index: m.index, text: m[0], bytes: Buffer.byteLength(m[0], 'utf8') });
}
blocks.sort((a, b) => b.bytes - a.bytes);
const target = blocks[0];
console.log('rewriting doc block at', target.index, 'bytes', target.bytes);
const budget = target.bytes - added;
console.log('replacement budget =', budget);
if (budget < 120) throw new Error('budget too small');

// Essential content of the block we are shrinking (writeFileAtomic semantics).
const body = [
  '* Replace `filename` with `content` in one atomic step, creating parent directories.',
  '* The content is written to a random-suffix sibling opened with exclusive create (`wx`),',
  '* so the open refuses to follow a symlink planted at the temp path and the fresh inode',
  '* carries `options.mode` through the rename. The rename is retried on Windows sharing',
  '* violations. A crash leaves either the old file or the new one, never a partial write.',
  '* @param filename - destination path, replaced in place.',
  '* @param content - complete new file content.',
  '* @param options - `mode` for the new file and the Windows rename retry bounds.',
  '* @returns Resolves once the destination holds the new content.',
].join('\n');

const head = '/**\n';
const tail = '\n*/';
const padBytes = budget - Buffer.byteLength(head + body + tail, 'utf8');
console.log('pad bytes =', padBytes);
if (padBytes < 0) throw new Error('body too long by ' + -padBytes);

// Pad with an extra prose line made of spaces after '*' so the comment stays valid.
const padLine = padBytes >= 3 ? '\n*' + ' '.repeat(padBytes - 2) : '';
let replacement = head + body + padLine + tail;
// Exact-size guard (padLine may fall short by rounding).
let diff = budget - Buffer.byteLength(replacement, 'utf8');
if (diff !== 0) {
  if (diff < 0) throw new Error('replacement overshoot by ' + -diff);
  replacement = replacement.replace(tail, ' '.repeat(diff) + tail);
}
if (Buffer.byteLength(replacement, 'utf8') !== budget) throw new Error('replacement size mismatch');

if (out.split(target.text).length - 1 !== 1) throw new Error('block not unique');
out = out.replace(target.text, () => replacement);

const finalBytes = Buffer.byteLength(out, 'utf8');
console.log('\noriginal bytes =', originalBytes, ' final bytes =', finalBytes, ' EQUAL =', finalBytes === originalBytes);
if (finalBytes !== originalBytes) throw new Error('size mismatch by ' + (finalBytes - originalBytes));

fs.writeFileSync(DST, out, 'utf8');
console.log('wrote', DST);
console.log('\n--- replacement block (first 400 chars) ---');
console.log(replacement.slice(0, 400));
console.log('--- replacement block (last 120 chars) ---');
console.log(JSON.stringify(replacement.slice(-120)));
