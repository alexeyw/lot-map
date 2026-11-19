// Paints the pictures of docs/options.md with the mod's own painter: one made-up session, drawn under each value of
// each option that changes the map. Stills are PNG; `motion` is a GIF, since its difference is in the moving.
// Run from the repository's root: `node scripts/option-pictures.mjs`. Needs ffmpeg and a Node that runs TypeScript.
// The pictures of the pane and of a terminal in that page are window shots and are not made here.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

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
mkdirSync(OUT, { recursive: true })

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
  const args = ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', size, '-r', String(FPS), '-i', '-']
  if (under !== undefined) args.push('-f', 'lavfi', '-i', `color=c=${under}:s=${size}`, '-filter_complex', '[1][0]overlay=shortest=1')
  if (moves) args.push('-vf', 'split[a][b];[a]palettegen=max_colors=255:stats_mode=full[p];[b][p]paletteuse=dither=none', '-loop', '0')
  else args.push('-frames:v', '1')
  const ffmpeg = spawn('ffmpeg', [...args, OUT + name], { stdio: ['pipe', 'inherit', 'inherit'] })
  const times = moves ? Array.from({ length: Math.floor((LENGTH * FPS) / 1000) }, (_, i) => (i * 1000) / FPS) : [STILL_AT]
  for (const time of times) {
    // The painter paints every frame on one canvas: the bytes are copied before the next one.
    if (!ffmpeg.stdin.write(Buffer.from(frameAt(time).rgba))) await new Promise(resolve => ffmpeg.stdin.once('drain', resolve))
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
await picture('background-transparent.png', { ...DARK, background: 'transparent' }, '0x24364f')
await picture('colors-own.png', { ...DARK, colors: ['accent=#7fb4ff', 'active=#b8d6ff', 'text=#e6edf7'] })
await picture('layout-you-bottom.png', { ...DARK, layout: 'you-bottom' })
await picture('motion-full.gif', DARK)
await picture('motion-reduced.gif', { ...DARK, motion: 'reduced' })
await picture('core-name-own.png', { ...DARK, coreName: 'HOME' })
await picture('language-ru.png', { ...DARK, language: 'ru' })
