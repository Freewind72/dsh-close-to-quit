// Apply the size-neutral lib/main.js payload patch to a COPY of app.asar, then verify:
//  1. entry size / offset unchanged
//  2. header JSON unchanged  -> ELECTRONASAR integrity hash still matches
//  3. payload reads back as the patched text
//  4. every other entry still readable (spot check)
//
// usage: node apply.cjs <srcArchive> <dstArchive> <patchedMainJs>
const fs = require('node:fs');
const crypto = require('node:crypto');

const [, , SRC, DST, PATCHED] = process.argv;
if (!SRC || !DST || !PATCHED) {
  console.error('usage: node apply.cjs <srcArchive> <dstArchive> <patchedMainJs>');
  process.exit(2);
}

const ENTRY = 'lib/main.js';
const EXPECTED_HEADER_SHA = '69828bdcbb189485291e3901a027d46d2f665a36fc8441034052da328b173ba9';

// ---------- read source header ----------
const srcFd = fs.openSync(SRC, 'r');
const pre = Buffer.alloc(16);
fs.readSync(srcFd, pre, 0, 16, 0);
if (pre.readUInt32LE(0) !== 4) throw new Error('not an asar archive');
const headerSize = pre.readUInt32LE(4);
const jsonSize = pre.readUInt32LE(12);
const dataOffset = 8 + headerSize;
const headerJson = Buffer.alloc(jsonSize);
fs.readSync(srcFd, headerJson, 0, jsonSize, 16);
const header = JSON.parse(headerJson.toString('utf8'));

function findEntry(node, parts) {
  let cur = node;
  for (const p of parts) {
    if (!cur.files || !cur.files[p]) return undefined;
    cur = cur.files[p];
  }
  return cur;
}
const entry = findEntry(header, ENTRY.split('/'));
if (!entry) throw new Error(`entry ${ENTRY} not found`);
console.log(`entry ${ENTRY}: size=${entry.size} offset=${entry.offset} unpacked=${Boolean(entry.unpacked)}`);

const patchedText = fs.readFileSync(PATCHED, 'utf8');
const patchedBuf = Buffer.from(patchedText, 'utf8');
console.log(`patched payload bytes = ${patchedBuf.length}`);
if (patchedBuf.length !== Number(entry.size)) {
  throw new Error(`size mismatch: patched ${patchedBuf.length} != entry ${entry.size}`);
}
if (!patchedBuf.toString('utf8').includes('closeButtonAction')) throw new Error('patch marker missing');

// ---------- verify the integrity hash over the header JSON ----------
const headerSha = crypto.createHash('sha256').update(headerJson).digest('hex');
console.log(`header sha256 = ${headerSha}`);
console.log(`integrity ${headerSha === EXPECTED_HEADER_SHA ? 'MATCHES' : 'DIFFERS FROM'} ELECTRONASAR value`);
if (headerSha !== EXPECTED_HEADER_SHA) throw new Error('header changed - refusing to write');

// ---------- copy the archive ----------
fs.copyFileSync(SRC, DST);
const dstFd = fs.openSync(DST, 'r+');
fs.writeSync(dstFd, patchedBuf, 0, patchedBuf.length, dataOffset + Number(entry.offset));

// ---------- verify ----------
const check = Buffer.alloc(patchedBuf.length);
fs.readSync(dstFd, check, 0, patchedBuf.length, dataOffset + Number(entry.offset));
const same = crypto.createHash('sha256').update(check).digest('hex') === crypto.createHash('sha256').update(patchedBuf).digest('hex');
console.log(`payload readback identical = ${same}`);
if (!same) throw new Error('readback mismatch');

const dstHeader = Buffer.alloc(jsonSize);
fs.readSync(dstFd, dstHeader, 0, jsonSize, 16);
const dstSha = crypto.createHash('sha256').update(dstHeader).digest('hex');
console.log(`dst header sha256 = ${dstSha}  matches source = ${dstSha === headerSha}`);

// spot-check neighbours
for (const p of ['lib/preload-app.cjs', 'package.json', 'dsh/package.json']) {
  const e = findEntry(header, p.split('/'));
  const b = Buffer.alloc(Number(e.size));
  fs.readSync(dstFd, b, 0, Number(e.size), dataOffset + Number(e.offset));
  const h = crypto.createHash('sha256').update(b).digest('hex');
  console.log(`  ${p}: hashMatch=${h === e.integrity.hash}`);
}

fs.closeSync(dstFd);
fs.closeSync(srcFd);

const srcSize = fs.statSync(SRC).size;
const dstSize = fs.statSync(DST).size;
console.log(`\narchive size: src=${srcSize} dst=${dstSize} equal=${srcSize === dstSize}`);
console.log('APPLIED OK');
