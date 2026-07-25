// ZIP "store" (sem compressão — PDFs já vêm comprimidos). Sem dependência externa:
// é o mesmo formato que o Windows, o macOS e o Linux abrem com dois cliques.
// Usado pela íntegra dos autos (/api/jusbr/integra) e pelo dossiê do Estagiário
// Virtual (/api/robo/minutas).

let CRCT = null
export function crc32(buf) {
  if (!CRCT) { CRCT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRCT[n] = c >>> 0 } }
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRCT[(crc ^ buf[i]) & 0xFF]
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// files: [{ name, data:Buffer }] → Buffer do .zip
export function zip(files) {
  const chunks = [], central = []; let offset = 0
  for (const f of files) {
    const nome = Buffer.from(f.name, 'utf8'), crc = crc32(f.data), size = f.data.length
    const lfh = Buffer.alloc(30)
    lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt16LE(0x0800, 6); lfh.writeUInt16LE(0, 8)
    lfh.writeUInt16LE(0, 10); lfh.writeUInt16LE(0x21, 12); lfh.writeUInt32LE(crc, 14); lfh.writeUInt32LE(size, 18)
    lfh.writeUInt32LE(size, 22); lfh.writeUInt16LE(nome.length, 26); lfh.writeUInt16LE(0, 28)
    chunks.push(lfh, nome, f.data)
    const cdh = Buffer.alloc(46)
    cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(20, 4); cdh.writeUInt16LE(20, 6); cdh.writeUInt16LE(0x0800, 8)
    cdh.writeUInt16LE(0, 10); cdh.writeUInt16LE(0, 12); cdh.writeUInt16LE(0x21, 14); cdh.writeUInt32LE(crc, 16)
    cdh.writeUInt32LE(size, 20); cdh.writeUInt32LE(size, 24); cdh.writeUInt16LE(nome.length, 28); cdh.writeUInt16LE(0, 30)
    cdh.writeUInt16LE(0, 32); cdh.writeUInt16LE(0, 34); cdh.writeUInt16LE(0, 36); cdh.writeUInt32LE(0, 38); cdh.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cdh, nome]))
    offset += 30 + nome.length + size
  }
  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, cd, eocd])
}
