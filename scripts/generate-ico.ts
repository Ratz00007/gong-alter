import sharp from 'sharp'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

async function generateIco() {
  const svgPath = join(process.cwd(), 'public', 'brand.svg')
  const svgBuf = readFileSync(svgPath)
  mkdirSync(join(process.cwd(), 'build'), { recursive: true })

  // Write high-res 512x512 PNGs for Electron window & packager
  const png512 = await sharp(svgBuf).resize(512, 512).png().toBuffer()
  writeFileSync(join(process.cwd(), 'build', 'icon.png'), png512)
  writeFileSync(join(process.cwd(), 'public', 'icon.png'), png512)

  const sizes = [16, 32, 48, 64, 128, 256]
  const pngBuffers: { size: number; buffer: Buffer }[] = []
  for (const size of sizes) {
    const buf = await sharp(svgBuf).resize(size, size).png().toBuffer()
    pngBuffers.push({ size, buffer: buf })
  }

  // ICO header: 6 bytes
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = ICO
  header.writeUInt16LE(sizes.length, 4) // image count

  // Directory entries: 16 bytes each
  const dirSize = 16 * sizes.length
  let offset = 6 + dirSize

  const dirBuffers: Buffer[] = []
  for (const img of pngBuffers) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(img.size === 256 ? 0 : img.size, 0) // width
    entry.writeUInt8(img.size === 256 ? 0 : img.size, 1) // height
    entry.writeUInt8(0, 2) // color count
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // planes
    entry.writeUInt16LE(32, 6) // bit count
    entry.writeUInt32LE(img.buffer.length, 8) // size of image data
    entry.writeUInt32LE(offset, 12) // offset
    dirBuffers.push(entry)
    offset += img.buffer.length
  }

  const icoBuffer = Buffer.concat([header, ...dirBuffers, ...pngBuffers.map((b) => b.buffer)])
  writeFileSync(join(process.cwd(), 'build', 'icon.ico'), icoBuffer)
  console.log('Successfully generated VALENCE icons: build/icon.ico, build/icon.png, public/icon.png')
}

generateIco()
