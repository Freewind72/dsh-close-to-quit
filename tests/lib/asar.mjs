// Shared helper: read one file out of an asar archive without any dependency.
//
// asar layout:
//   u32 magic (= 4) | u32 headerSize | u32 paddedJsonSize | u32 jsonSize
//   then the JSON header (jsonSize bytes)
//   then the data region, starting at 8 + headerSize
//
// Each packed entry carries `offset` (relative to the data region) and `size`.

import { openSync, readSync, closeSync } from 'node:fs'

export function readAsarEntry(archivePath, entryPath) {
  const fd = openSync(archivePath, 'r')
  try {
    const pre = Buffer.alloc(16)
    readSync(fd, pre, 0, 16, 0)
    if (pre.readUInt32LE(0) !== 4) throw new Error('not an asar archive')
    const headerSize = pre.readUInt32LE(4)
    const jsonSize = pre.readUInt32LE(12)
    const dataOffset = 8 + headerSize

    const json = Buffer.alloc(jsonSize)
    readSync(fd, json, 0, jsonSize, 16)
    const header = JSON.parse(json.toString('utf8'))

    let node = header
    for (const part of entryPath.split('/')) {
      if (!node.files || !node.files[part]) throw new Error(`entry not found: ${entryPath}`)
      node = node.files[part]
    }
    if (node.unpacked) throw new Error(`${entryPath} is unpacked`)

    const payload = Buffer.alloc(Number(node.size))
    readSync(fd, payload, 0, Number(node.size), dataOffset + Number(node.offset))
    return { payload, entry: node, headerJson: json }
  } finally {
    closeSync(fd)
  }
}

/** Read the header JSON hash-relevant bytes (what Electron's ELECTRONASAR check covers). */
export function readAsarHeader(archivePath) {
  const fd = openSync(archivePath, 'r')
  try {
    const pre = Buffer.alloc(16)
    readSync(fd, pre, 0, 16, 0)
    const jsonSize = pre.readUInt32LE(12)
    const json = Buffer.alloc(jsonSize)
    readSync(fd, json, 0, jsonSize, 16)
    return json
  } finally {
    closeSync(fd)
  }
}

/** Resolve the archive under test: $DSH_ASAR, argv[2], or the usual install path. */
export function resolveArchive(argv = process.argv) {
  return process.env.DSH_ASAR ?? argv[2] ?? 'E:/dsh/resources/app.asar'
}
