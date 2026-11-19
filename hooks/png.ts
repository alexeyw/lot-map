// A painted frame as the terminal takes it: a PNG, deflated here, in base64. Nothing here touches the engine.
import type { Frame } from './raster'

/** An Image takes at most this many bytes of pixels. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024

export type ImageBytes = { png: string } | { rgba: string; width: number; height: number }

/** A frame as an Image takes it: a PNG, some ten times smaller on the map's flat colours, or the raw pixels if that is not smaller. */
export function imageSource(frame: Frame): ImageBytes {
  const file = toPng(frame)
  return file.length < Math.min(frame.rgba.length, MAX_IMAGE_BYTES)
    ? { png: toBase64(file) }
    : { rgba: toBase64(frame.rgba), width: frame.width, height: frame.height }
}

// ---- PNG, deflated here: the environment has no zlib -----------------------------------------------
//
// One block of deflate's fixed codes, with repeats looked for a whole pixel at a time, in two places only:
// the pixel to the left and the one a row up. The map is flat colour around soft edges, so that finds most
// of what a full search would, in a few milliseconds a frame.

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DISTANCE_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
/** How far back deflate may reach. */
const WINDOW = 32_768

function reversed(value: number, bits: number): number {
  let r = 0
  for (let i = 0; i < bits; i++, value >>= 1) r = (r << 1) | (value & 1)
  return r
}

/** Each literal and length symbol's fixed code, bit-reversed as deflate sends it, and its length in bits. */
const LITERAL_CODE = new Uint16Array(288)
const LITERAL_BITS = new Uint8Array(288)
for (let s = 0; s < 288; s++) {
  const [code, bits] = s < 144 ? [0x30 + s, 8] : s < 256 ? [0x190 + s - 144, 9] : s < 280 ? [s - 256, 7] : [0xc0 + s - 280, 8]
  LITERAL_CODE[s] = reversed(code, bits)
  LITERAL_BITS[s] = bits
}

/** The length code of each match length from 3 to 258. */
const LENGTH_CODE = new Uint8Array(259)
for (let c = 0; c < LENGTH_BASE.length; c++) {
  const end = c === LENGTH_BASE.length - 1 ? 259 : (LENGTH_BASE[c + 1] as number)
  for (let l = LENGTH_BASE[c] as number; l < end; l++) LENGTH_CODE[l] = c
}

/** Bits written least significant first, as deflate packs them. */
class Bits {
  bytes = new Uint8Array(1 << 16)
  length = 0
  private acc = 0
  private count = 0

  put(value: number, bits: number): void {
    this.acc |= value << this.count
    this.count += bits
    while (this.count >= 8) {
      if (this.length === this.bytes.length) {
        const grown = new Uint8Array(this.bytes.length * 2)
        grown.set(this.bytes)
        this.bytes = grown
      }
      this.bytes[this.length++] = this.acc & 255
      this.acc >>>= 8
      this.count -= 8
    }
  }

  /** The bytes, the last one padded out. */
  done(): Uint8Array {
    if (this.count > 0) this.put(0, 8 - this.count)
    return this.bytes.subarray(0, this.length)
  }
}

/** A repeat `d` bytes back as deflate sends it: its code, bit-reversed, then its extra bits. */
function distanceOf(d: number): { code: number; extra: number; bits: number } {
  let c = 0
  while (c < DISTANCE_BASE.length - 1 && (DISTANCE_BASE[c + 1] as number) <= d) c++
  return { code: reversed(c, 5), extra: d - (DISTANCE_BASE[c] as number), bits: DISTANCE_EXTRA[c] as number }
}

/** The frame's rows, each behind its filter byte (0, none), deflated in one block of fixed codes. */
function deflate({ width, height, rgba }: Frame): Uint8Array {
  // A frame from `paint` starts on a four-byte boundary, so its pixels can be compared whole.
  const pixels = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height)
  const row = width * 4 + 1
  const left = distanceOf(4)
  const up = distanceOf(row)
  const out = new Bits()
  const symbol = (s: number): void => out.put(LITERAL_CODE[s] as number, LITERAL_BITS[s] as number)
  out.put(1, 1) // the last block
  out.put(1, 2) // of fixed codes
  for (let y = 0; y < height; y++) {
    symbol(0) // the row's filter byte
    const start = y * width
    const end = start + width
    for (let p = start; p < end; ) {
      // At most 64 pixels, as many whole pixels as deflate's longest repeat holds, and never past the row's end.
      const most = Math.min(64, end - p)
      let l = 0
      if (p > start) while (l < most && pixels[p + l] === pixels[p + l - 1]) l++
      let u = 0
      if (y > 0 && row <= WINDOW && l < most) while (u < most && pixels[p + u] === pixels[p + u - width]) u++
      if (l === 0 && u === 0) {
        for (let j = p * 4; j < p * 4 + 4; j++) symbol(rgba[j] as number)
        p++
        continue
      }
      const n = Math.max(l, u)
      const back = l >= u ? left : up
      const c = LENGTH_CODE[n * 4] as number
      symbol(257 + c)
      out.put(n * 4 - (LENGTH_BASE[c] as number), LENGTH_EXTRA[c] as number)
      out.put(back.code, 5)
      out.put(back.extra, back.bits)
      p += n
    }
  }
  symbol(256) // the block's end
  return out.done()
}

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 255] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** zlib's checksum of the frame's rows as the PNG holds them, each behind its filter byte. */
function adler32({ width, rgba }: Frame): number {
  let a = 1
  let b = 0
  // Reduced a row at a time: JavaScript's numbers hold the sums exactly for far longer than a row.
  for (let start = 0; start < rgba.length; start += width * 4) {
    b += a // the filter byte, 0
    for (let i = start; i < start + width * 4; i++) {
      a += rgba[i] as number
      b += a
    }
    a %= 65521
    b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

/** The frame as a whole PNG file: RGBA at eight bits a channel, rows unfiltered. */
function toPng(frame: Frame): Uint8Array {
  const { width, height } = frame
  const deflated = deflate(frame)

  const chunks: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])]
  const chunk = (type: string, data: Uint8Array): void => {
    const out = new Uint8Array(12 + data.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, data.length)
    for (let k = 0; k < 4; k++) out[4 + k] = type.charCodeAt(k)
    out.set(data, 8)
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
    chunks.push(out)
  }
  const header = new Uint8Array(13)
  const headerView = new DataView(header.buffer)
  headerView.setUint32(0, width)
  headerView.setUint32(4, height)
  header.set([8, 6, 0, 0, 0], 8) // 8 bits a channel, RGBA, deflate, filtered by row, not interlaced
  chunk('IHDR', header)
  const z = new Uint8Array(deflated.length + 6)
  z.set([0x78, 0x01]) // zlib: deflate with a 32K window, no dictionary
  z.set(deflated, 2)
  new DataView(z.buffer).setUint32(2 + deflated.length, adler32(frame))
  chunk('IDAT', z)
  chunk('IEND', new Uint8Array(0))

  const file = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) {
    file.set(c, at)
    at += c.length
  }
  return file
}

// ---- base64 ---------------------------------------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

export const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), c => c.charCodeAt(0))
