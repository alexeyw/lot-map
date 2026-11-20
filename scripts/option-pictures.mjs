// Paints the pictures of docs/options.md with the mod's own painter: one made-up session, drawn under each value of
// each option that changes the map. Stills are PNG; `motion` is a GIF, since its difference is in the moving.
// Run from the repository's root: `node scripts/option-pictures.mjs`. Needs ffmpeg and a Node that runs TypeScript.
// The pictures of the pane and of a terminal in that page are window shots and are not made here.
//
// `node scripts/option-pictures.mjs --check` writes nothing and needs no ffmpeg: it paints each still again and holds
// the picture in docs/options/ against it, pixel by pixel, so a change to the drawing that left a picture behind
// fails the check. The two GIFs are not looked at.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'

// The mod imports its own files without an extension; node wants one.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const url = new URL(specifier, context.parentURL)
      for (const ext of ['.ts', '/index.d.ts']) if (existsSync(fileURLToPath(url) + ext)) return next(url.href + ext, context)
    }
    return next(specifier, context)
  },
})

const hooks = name => new URL(`../hooks/${name}.ts`, import.meta.url).href
const { drawMap } = await import(hooks('draw'))
const { setupFrom } = await import(hooks('setup'))
const { parseMap } = await import(hooks('scene'))
const { paint } = await import(hooks('raster'))

const OUT = fileURLToPath(new URL('../docs/options/', import.meta.url))
const CHECK = process.argv.includes('--check')
if (!CHECK) mkdirSync(OUT, { recursive: true })

const T0 = 1_000_000
const LENGTH = 6400
const FPS = 10
const SCALE = 0.8
/** The moment the stills show: the network and the memory at work, a route behind them. */
const STILL_AT = 4000

// The session: a station, when its call starts and ends in ms, and whether it comes from the person.
const calls = [
  ['you', 0, 100, 'inbound'], ['model', 100, 700], ['files', 700, 1500], ['model', 1500, 2000], ['shell', 2000, 3200],
  ['model', 3200, 3700], ['web', 3700, 4700], ['memory', 3800, 4400], ['model', 4700, 5200], ['agents', 5200, 6000],
]
const changes = [...new Set(calls.flatMap(c => [c[1], c[2]]))].sort((a, b) => a - b)
const boardAt = time => {
  const entries = []
  const counts = {}
  calls.forEach(([station, from, to, origin], i) => {
    if (from > time) return
    counts[station] = (counts[station] ?? 0) + 1
    entries.push({ id: `e${i}`, station, label: station, from: origin ?? 'core', startedAt: T0 + from, ...(to <= time ? { endedAt: T0 + to } : {}), status: to <= time ? 'ok' : 'run' })
  })
  return { entries, counts, context: 42, model: 'claude-opus-5-5' }
}

/** A PNG file's pixels as RGBA: eight bits a channel, with or without alpha, not interlaced, which is what ffmpeg writes here. */
function pixelsOf(file) {
  const bytes = readFileSync(file)
  let width = 0
  let height = 0
  let channels = 0
  const data = []
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString('latin1', at + 4, at + 8)
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      channels = body[9] === 6 ? 4 : body[9] === 2 ? 3 : 0
      if (body[8] !== 8 || channels === 0 || body[12] !== 0) throw new Error(`${file}: a PNG of a kind this check does not read`)
    }
    if (type === 'IDAT') data.push(body)
    at += length + 12
  }
  const rows = inflateSync(Buffer.concat(data))
  const stride = width * channels
  const rgba = new Uint8Array(width * height * 4)
  let before = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const filter = rows[y * (stride + 1)]
    const row = Uint8Array.from(rows.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels] : 0
      const up = before[i]
      const corner = i >= channels ? before[i - channels] : 0
      // Paeth: whichever of left, up and corner is nearest to left + up - corner.
      const guess = left + up - corner
      const [toLeft, toUp, toCorner] = [Math.abs(guess - left), Math.abs(guess - up), Math.abs(guess - corner)]
      const paeth = toLeft <= toUp && toLeft <= toCorner ? left : toUp <= toCorner ? up : corner
      row[i] += [0, left, up, (left + up) >> 1, paeth][filter]
    }
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) rgba[(y * width + x) * 4 + c] = row[x * channels + c]
      rgba[(y * width + x) * 4 + 3] = channels === 4 ? row[x * channels + 3] : 255
    }
    before = row
  }
  return { width, height, rgba }
}

/** The frame laid over a colour, for a map painted without its ground: what stands behind it in the picture. */
function over(frame, under) {
  if (under === undefined) return frame.rgba
  const ground = [16, 8, 0].map(shift => (under >> shift) & 255)
  const rgba = new Uint8Array(frame.rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = frame.rgba[i + 3] / 255
    for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(frame.rgba[i + c] * alpha + ground[c] * (1 - alpha))
    rgba[i + 3] = 255
  }
  return rgba
}

/** The still held against its file: how many of the file's pixels are not the painted ones. */
function held(name, frame, under) {
  const file = pixelsOf(OUT + name)
  if (file.width !== frame.width || file.height !== frame.height) return `is ${file.width}x${file.height}, painted ${frame.width}x${frame.height}`
  const painted = over(frame, under)
  let off = 0
  for (let i = 0; i < painted.length; i += 4) {
    if (painted[i] !== file.rgba[i] || painted[i + 1] !== file.rgba[i + 1] || painted[i + 2] !== file.rgba[i + 2] || painted[i + 3] !== file.rgba[i + 3]) off++
  }
  return off === 0 ? undefined : `${off} of ${frame.width * frame.height} pixels are not what the mod paints now`
}

let stale = 0

/** One picture: `name` with `.gif` moves, anything else is the still. `under` is a colour laid behind a map without its ground. */
async function picture(name, options, under) {
  const setup = setupFrom(options)
  const scenes = new Map(changes.map(time => [time, parseMap(drawMap(boardAt(time), T0 + time, setup))]))
  const frameAt = time => {
    const drawn = changes.filter(c => c <= time).pop() ?? 0
    return paint(scenes.get(drawn), time - drawn, SCALE)
  }
  const first = frameAt(0)
  const size = `${first.width}x${first.height}`
  const moves = name.endsWith('.gif')
  if (CHECK) {
    const fault = moves ? undefined : held(name, frameAt(STILL_AT), under)
    if (fault !== undefined) stale++
    console.log(`${name} ${moves ? 'a GIF, not looked at' : (fault ?? 'as painted')}`)
    return
  }
  const args = ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', size, '-r', String(FPS), '-i', '-']
  if (moves) args.push('-vf', 'split[a][b];[a]palettegen=max_colors=255:stats_mode=full[p];[b][p]paletteuse=dither=none', '-loop', '0')
  else args.push('-frames:v', '1')
  const ffmpeg = spawn('ffmpeg', [...args, OUT + name], { stdio: ['pipe', 'inherit', 'inherit'] })
  const times = moves ? Array.from({ length: Math.floor((LENGTH * FPS) / 1000) }, (_, i) => (i * 1000) / FPS) : [STILL_AT]
  for (const time of times) {
    // The painter paints every frame on one canvas: the bytes are copied before the next one.
    if (!ffmpeg.stdin.write(Buffer.from(over(frameAt(time), under)))) await new Promise(resolve => ffmpeg.stdin.once('drain', resolve))
  }
  ffmpeg.stdin.end()
  const code = await new Promise(resolve => ffmpeg.on('close', resolve))
  if (code !== 0) process.exitCode = 1
  console.log(`${name} ${size}`)
}

const DARK = { theme: 'dark' }
// The map as it comes, in the dark colours: the picture every option's default shares.
await picture('default.png', DARK)
await picture('theme-light.png', { theme: 'light' })
await picture('background-transparent.png', { ...DARK, background: 'transparent' }, 0x24364f)
await picture('colors-own.png', { ...DARK, colors: ['accent=#7fb4ff', 'active=#b8d6ff', 'text=#e6edf7'] })
await picture('layout-you-bottom.png', { ...DARK, layout: 'you-bottom' })
await picture('motion-full.gif', DARK)
await picture('motion-reduced.gif', { ...DARK, motion: 'reduced' })
await picture('core-name-own.png', { ...DARK, coreName: 'HOME' })
await picture('language-ru.png', { ...DARK, language: 'ru' })

if (CHECK && stale > 0) {
  console.error(`option-pictures: ${stale} of the pictures in docs/options/ are behind the drawing. Run node scripts/option-pictures.mjs and commit them.`)
  process.exitCode = 1
}
