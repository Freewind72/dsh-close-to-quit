// Extract lib/main.js from an installed DeepSeek Harness app.asar.
//
// This repo deliberately does NOT ship main.orig.js: that file is DeepSeek's own code.
// Run this once against your installation to produce the file build-patch.cjs consumes.
//
// usage: node extract-main.cjs <app.asar> [outFile]
//   default outFile = main.orig.js next to this script
const fs = require('node:fs');
const path = require('node:path');

const ENTRY = 'lib/main.js';
const [, , ASAR, OUT] = process.argv;
if (!ASAR) {
  console.error('usage: node extract-main.cjs <app.asar> [outFile]');
  process.exit(2);
}
const outFile = OUT ?? path.join(__dirname, 'main.orig.js');

// asar layout: u32 magic, u32 headerSize, u32 pad, u32 jsonSize, then the JSON header,
// then the data region starting at 8 + headerSize.
const fd = fs.openSync(ASAR, 'r');
const pre = Buffer.alloc(16);
fs.readSync(fd, pre, 0, 16, 0);
if (pre.readUInt32LE(0) !== 4) throw new Error('not an asar archive');
const headerSize = pre.readUInt32LE(4);
const jsonSize = pre.readUInt32LE(12);
const dataOffset = 8 + headerSize;

const json = Buffer.alloc(jsonSize);
fs.readSync(fd, json, 0, jsonSize, 16);
const header = JSON.parse(json.toString('utf8'));

let node = header;
for (const part of ENTRY.split('/')) {
  if (!node.files || !node.files[part]) throw new Error(`entry not found: ${ENTRY}`);
  node = node.files[part];
}
if (node.unpacked) throw new Error(`${ENTRY} is unpacked; read it from app.asar.unpacked instead`);

const payload = Buffer.alloc(Number(node.size));
fs.readSync(fd, payload, 0, Number(node.size), dataOffset + Number(node.offset));
fs.closeSync(fd);

fs.writeFileSync(outFile, payload);
console.log(`extracted ${ENTRY}: ${payload.length} bytes -> ${outFile}`);
console.log('next: node build-patch.cjs');
