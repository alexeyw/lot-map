// The map as pixels, for a terminal that shows pictures but not SVG.
// It takes the drawing as `scene.ts` read it and paints one moment of it into RGBA pixels; `png.ts` packs the
// pixels for the terminal. Nothing here touches the engine.
import { BOLD, FONTS } from './font'
import type { BitmapFont } from './font'
import { MAX_IMAGE_BYTES, fromBase64 } from './png'
import { colorOf, dashed, ellipseOf, IDENTITY, lengthOf, num, numbers, progress, rotation, transformOf, valueAt } from './scene'
import type { Animation, Matrix, Point, Rgb, Scene, Shape, Sub } from './scene'

// ---- paint ---------------------------------------------------------------------------------------

class Canvas {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8ClampedArray
  /** Coverage of the shape being painted, 0 to 1, composited and cleared once the shape is whole. */
  readonly mask: Float32Array
  private x0 = 0
  private y0 = 0
  private x1 = -1
  private y1 = -1

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.rgba = new Uint8ClampedArray(width * height * 4)
    this.mask = new Float32Array(width * height)
  }

  /** Widens the area the mask covers and answers the part of the box that lies on the canvas. */
  touch(xa: number, ya: number, xb: number, yb: number): [number, number, number, number] {
    const x0 = Math.max(0, Math.floor(xa))
    const y0 = Math.max(0, Math.floor(ya))
    const x1 = Math.min(this.width - 1, Math.ceil(xb))
    const y1 = Math.min(this.height - 1, Math.ceil(yb))
    if (x0 <= x1 && y0 <= y1) {
      if (this.x1 < this.x0) [this.x0, this.y0, this.x1, this.y1] = [x0, y0, x1, y1]
      else {
        this.x0 = Math.min(this.x0, x0)
        this.y0 = Math.min(this.y0, y0)
        this.x1 = Math.max(this.x1, x1)
        this.y1 = Math.max(this.y1, y1)
      }
    }
    return [x0, y0, x1, y1]
  }

  /** Lays one color over the canvas through the mask, then clears the mask. */
  composite([r, g, b]: Rgb, opacity: number): void {
    const { mask, rgba, width } = this
    for (let y = this.y0; y <= this.y1; y++) {
      for (let x = this.x0; x <= this.x1; x++) {
        const i = y * width + x
        const c = mask[i] as number
        if (c <= 0) continue
        mask[i] = 0
        blend(rgba, i * 4, r, g, b, c * opacity)
      }
    }
    this.x1 = this.x0 - 1
    this.y1 = this.y0 - 1
  }
}

/** Source over, with straight alpha, so that a map without its ground keeps clean edges. */
function blend(rgba: Uint8ClampedArray, j: number, r: number, g: number, b: number, a: number): void {
  if (a <= 0) return
  const da = (rgba[j + 3] as number) / 255
  const keep = da * (1 - a)
  const oa = a + keep
  rgba[j] = (r * a + (rgba[j] as number) * keep) / oa
  rgba[j + 1] = (g * a + (rgba[j + 1] as number) * keep) / oa
  rgba[j + 2] = (b * a + (rgba[j + 2] as number) * keep) / oa
  rgba[j + 3] = oa * 255
}

function fillDisk(cv: Canvas, cx: number, cy: number, r: number): void {
  const [x0, y0, x1, y1] = cv.touch(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1)
  const { mask, width } = cv
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = Math.min(1, r + 0.5 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy))
      const i = y * width + x
      if (c > (mask[i] as number)) mask[i] = c
    }
  }
}

function strokeRing(cv: Canvas, cx: number, cy: number, r: number, half: number): void {
  const reach = r + half + 1
  const [x0, y0, x1, y1] = cv.touch(cx - reach, cy - reach, cx + reach, cy + reach)
  const { mask, width } = cv
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const c = Math.min(1, half + 0.5 - Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r))
      const i = y * width + x
      if (c > (mask[i] as number)) mask[i] = c
    }
  }
}

function fillRoundRect(cv: Canvas, x: number, y: number, w: number, h: number, radius: number): void {
  const [x0, y0, x1, y1] = cv.touch(x - 1, y - 1, x + w + 1, y + h + 1)
  const { mask, width } = cv
  const rr = Math.min(radius, w / 2, h / 2)
  const cx = x + w / 2
  const cy = y + h / 2
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const qx = Math.abs(px + 0.5 - cx) - (w / 2 - rr)
      const qy = Math.abs(py + 0.5 - cy) - (h / 2 - rr)
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr
      const c = Math.min(1, 0.5 - d)
      const i = py * width + px
      if (c > (mask[i] as number)) mask[i] = c
    }
  }
}

/** One straight piece of a stroke: a round end where `roundA`/`roundB` say (a cap or a join), else a flat one. */
function strokeSegment(cv: Canvas, ax: number, ay: number, bx: number, by: number, half: number, roundA: boolean, roundB: boolean): void {
  const pad = half + 1
  const [x0, y0, x1, y1] = cv.touch(Math.min(ax, bx) - pad, Math.min(ay, by) - pad, Math.max(ax, bx) + pad, Math.max(ay, by) + pad)
  const { mask, width } = cv
  const dx = bx - ax
  const dy = by - ay
  const length = Math.hypot(dx, dy)
  const ux = length > 0 ? dx / length : 1
  const uy = length > 0 ? dy / length : 0
  const reach = half + 0.5
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5
      const rx = px - ax
      const ry = py - ay
      const along = rx * ux + ry * uy
      let c: number
      if (along < 0 && roundA) c = reach - Math.hypot(rx, ry)
      else if (along > length && roundB) c = reach - Math.hypot(px - bx, py - by)
      else {
        c = reach - Math.abs(rx * uy - ry * ux)
        if (!roundA) c = Math.min(c, along + 0.5)
        if (!roundB) c = Math.min(c, length - along + 0.5)
      }
      if (c <= 0) continue
      const i = y * width + x
      if (c > 1) c = 1
      if (c > (mask[i] as number)) mask[i] = c
    }
  }
}

function strokeSubs(cv: Canvas, subs: readonly Sub[], half: number, roundCaps: boolean): void {
  for (const sub of subs) {
    const pts = sub.closed ? [...sub.points, sub.points[0] as Point] : sub.points
    if (pts.length === 1) {
      const p = pts[0] as Point
      if (roundCaps) strokeSegment(cv, p.x, p.y, p.x, p.y, half, true, true)
      continue
    }
    const last = pts.length - 2
    for (let k = 0; k <= last; k++) {
      const a = pts[k] as Point
      const b = pts[k + 1] as Point
      strokeSegment(cv, a.x, a.y, b.x, b.y, half, k > 0 || sub.closed || roundCaps, k < last || sub.closed || roundCaps)
    }
  }
}

/** Where a point of the shape lands on the canvas at `t`: its transform, its flight, the groups it sits in, then the scale. */
function placer(shape: Shape, t: number, scale: number): (p: Point) => Point {
  const m = transformOf(shape.attrs.transform) ?? IDENTITY
  let mx = 0
  let my = 0
  for (const a of shape.animations) {
    if (a.kind !== 'motion') continue
    const p = progress(a, t)
    if (p === undefined) continue
    mx = a.from.x + (a.to.x - a.from.x) * p
    my = a.from.y + (a.to.y - a.from.y) * p
  }
  // Each group, innermost first: its turn while one runs, else its own transform.
  const around = shape.groups.map(g => turnOf(g.turns, t) ?? g.matrix)
  return p => {
    let x = m[0] * p.x + m[2] * p.y + m[4] + mx
    let y = m[1] * p.x + m[3] * p.y + m[5] + my
    for (const g of around) {
      const gx = g[0] * x + g[2] * y + g[4]
      y = g[1] * x + g[3] * y + g[5]
      x = gx
    }
    return { x: x * scale, y: y * scale }
  }
}

/** The rotation a group's turns give it at `t`, the last running one winning; undefined while none runs. */
function turnOf(turns: readonly Animation[], t: number): Matrix | undefined {
  let turn: Matrix | undefined
  for (const a of turns) {
    if (a.kind !== 'turn') continue
    const p = progress(a, t)
    if (p === undefined) continue
    const lerp = (k: number): number => (a.from[k] ?? 0) + ((a.to[k] ?? a.from[k] ?? 0) - (a.from[k] ?? 0)) * p
    turn = rotation(lerp(0), lerp(1), lerp(2))
  }
  return turn
}

function paintShape(cv: Canvas, shape: Shape, t: number, scale: number): void {
  const a = shape.attrs
  const opacity = Math.min(1, Math.max(0, valueAt(shape, 'opacity', num(a.opacity, 1), t)))
  if (opacity < 0.004) return
  const place = placer(shape, t, scale)
  if (shape.tag === 'text') {
    paintText(cv, shape, place, scale, opacity)
    return
  }
  const fill = shape.tag === 'line' ? undefined : colorOf(a.fill ?? '#000000')
  const stroke = colorOf(a.stroke)
  const half = (num(a['stroke-width'], 1) * scale) / 2

  if (shape.tag === 'rect') {
    if (fill === undefined) return
    const at = place({ x: num(a.x, 0), y: num(a.y, 0) })
    fillRoundRect(cv, at.x, at.y, num(a.width, 0) * scale, num(a.height, 0) * scale, num(a.rx, 0) * scale)
    cv.composite(fill, opacity)
    return
  }

  let outline: Sub[]
  if (shape.tag === 'circle') {
    const r = Math.max(0, valueAt(shape, 'r', num(a.r, 0), t))
    const c = { x: num(a.cx, 0), y: num(a.cy, 0) }
    const at = place(c)
    if (fill !== undefined) {
      fillDisk(cv, at.x, at.y, r * scale)
      cv.composite(fill, opacity)
    }
    if (stroke === undefined) return
    if (a['stroke-dasharray'] === undefined) {
      strokeRing(cv, at.x, at.y, r * scale, half)
      cv.composite(stroke, opacity)
      return
    }
    outline = [ellipseOf(c.x, c.y, r, r)]
  } else if (shape.tag === 'ellipse') {
    if (stroke === undefined) return
    outline = [ellipseOf(num(a.cx, 0), num(a.cy, 0), num(a.rx, 0), num(a.ry, 0))]
  } else if (shape.tag === 'line') {
    if (stroke === undefined) return
    outline = [{ points: [{ x: num(a.x1, 0), y: num(a.y1, 0) }, { x: num(a.x2, 0), y: num(a.y2, 0) }], closed: false }]
  } else {
    if (stroke === undefined) return
    outline = shape.subs ?? []
  }

  const pattern = numbers(a['stroke-dasharray'])
  if (pattern.length > 0) {
    // A pattern written against pathLength is stretched to the outline's real length.
    const real = outline.reduce((sum, sub) => sum + lengthOf(sub), 0)
    const k = a.pathLength !== undefined && num(a.pathLength, 0) > 0 && real > 0 ? real / num(a.pathLength, 1) : 1
    outline = dashed(outline, pattern.map(v => v * k), valueAt(shape, 'stroke-dashoffset', num(a['stroke-dashoffset'], 0), t) * k)
  }
  const placed = outline.map(sub => ({ points: sub.points.map(place), closed: sub.closed }))
  strokeSubs(cv, placed, half, a['stroke-linecap'] === 'round')
  cv.composite(stroke, opacity)
}

// ---- words -----------------------------------------------------------------------------------------

type Glyphs = { font: BitmapFont; bytes: Uint8Array; perRow: number; index: Map<number, number> }
const glyphCache = new Map<BitmapFont, Glyphs>()

function glyphsOf(font: BitmapFont): Glyphs {
  let glyphs = glyphCache.get(font)
  if (glyphs === undefined) {
    const index = new Map<number, number>()
    let k = 0
    for (const ch of font.chars) index.set(ch.codePointAt(0) as number, k++)
    glyphs = { font, bytes: fromBase64(font.bits), perRow: Math.ceil(font.width / 8), index }
    glyphCache.set(font, glyphs)
  }
  return glyphs
}

/** Whether a character has a glyph of its own in every size; one that has not is drawn as an empty box. */
export function hasGlyph(ch: string): boolean {
  const cp = ch.codePointAt(0) as number
  return FONTS.every(f => glyphsOf(f).index.has(cp))
}

/** One pixel of a glyph; `g` -1 is the empty box that stands for a character the font does not have. */
function bit(glyphs: Glyphs, g: number, x: number, y: number): number {
  const { width, height, ascent } = glyphs.font
  if (x < 0 || y < 0 || x >= width || y >= height) return 0
  if (g < 0) {
    const top = Math.max(1, height - ascent - 1)
    return ((x === 1 || x === width - 2) && y >= top && y <= ascent) || ((y === top || y === ascent) && x >= 1 && x <= width - 2) ? 1 : 0
  }
  return ((glyphs.bytes[(g * height + y) * glyphs.perRow + (x >> 3)] as number) >> (7 - (x & 7))) & 1
}

/** The bitmap size nearest the wanted pixel height, drawn as it is when that is near enough and scaled otherwise. */
function fontFor(px: number): { glyphs: Glyphs; k: number } {
  let best = FONTS[0] as BitmapFont
  for (const f of FONTS) if (Math.abs(f.height - px) < Math.abs(best.height - px)) best = f
  return { glyphs: glyphsOf(best), k: Math.abs(best.height - px) <= 1.5 ? 1 : px / best.height }
}

/** A glyph's coverage over the box at (gx, gy), scaled by k: each canvas pixel takes the share of glyph pixels under it. */
function stamp(glyphs: Glyphs, g: number, gx: number, gy: number, k: number, ink: Float32Array, owner: Uint16Array, bw: number, bh: number, who: number): void {
  const { width, height } = glyphs.font
  const x0 = Math.max(0, Math.floor(gx))
  const y0 = Math.max(0, Math.floor(gy))
  const x1 = Math.min(bw, Math.ceil(gx + width * k))
  const y1 = Math.min(bh, Math.ceil(gy + height * k))
  for (let ty = y0; ty < y1; ty++) {
    const v0 = (ty - gy) / k
    const v1 = (ty + 1 - gy) / k
    for (let tx = x0; tx < x1; tx++) {
      const u0 = (tx - gx) / k
      const u1 = (tx + 1 - gx) / k
      let sum = 0
      for (let sy = Math.floor(v0); sy < v1; sy++) {
        const oy = Math.min(v1, sy + 1) - Math.max(v0, sy)
        if (oy <= 0) continue
        for (let sx = Math.floor(u0); sx < u1; sx++) {
          const ox = Math.min(u1, sx + 1) - Math.max(u0, sx)
          if (ox > 0 && bit(glyphs, g, sx, sy) === 1) sum += ox * oy
        }
      }
      const c = sum / ((u1 - u0) * (v1 - v0))
      const i = ty * bw + tx
      if (c > (ink[i] as number)) {
        ink[i] = Math.min(1, c)
        owner[i] = who
      }
    }
  }
}

function paintText(cv: Canvas, shape: Shape, place: (p: Point) => Point, scale: number, opacity: number): void {
  const a = shape.attrs
  const base = colorOf(a.fill ?? '#000000')
  const chars: { cp: number; fill: Rgb | undefined }[] = []
  for (const run of shape.runs) {
    const fill = run.fill !== undefined ? colorOf(run.fill) : base
    for (const ch of run.text) chars.push({ cp: ch.codePointAt(0) as number, fill })
  }
  if (chars.length === 0) return

  const { glyphs, k } = fontFor(num(a['font-size'], 16) * scale)
  const isBold = a['font-weight'] === 'bold' || num(a['font-weight'], 400) >= 600
  const boldFont = isBold ? BOLD.find(f => f.height === glyphs.font.height) : undefined
  const bold = boldFont === undefined ? undefined : glyphsOf(boldFont)
  const spacing = num(a['letter-spacing'], 0) * scale
  const advance = glyphs.font.width * k
  const total = chars.length * advance + (chars.length - 1) * spacing
  const at = place({ x: num(a.x, 0), y: num(a.y, 0) })
  const anchor = a['text-anchor'] ?? 'start'
  const left = at.x - (anchor === 'middle' ? total / 2 : anchor === 'end' ? total : 0)
  const top = at.y - glyphs.font.ascent * k
  const rim = a['paint-order'] === 'stroke' && colorOf(a.stroke) !== undefined ? (num(a['stroke-width'], 1) * scale) / 2 : 0

  const pad = Math.ceil(rim) + 2
  const ox = Math.floor(left) - pad
  const oy = Math.floor(top) - pad
  const bw = Math.ceil(total) + 2 * pad + 3
  const bh = Math.ceil(glyphs.font.height * k) + 2 * pad + 2
  const ink = new Float32Array(bw * bh)
  const owner = new Uint16Array(bw * bh)
  chars.forEach((ch, i) => {
    let gx = left + i * (advance + spacing) - ox
    let gy = top - oy
    if (k === 1) {
      gx = Math.round(gx)
      gy = Math.round(gy)
    }
    const own = bold?.index.get(ch.cp)
    if (bold !== undefined && own !== undefined) stamp(bold, own, gx, gy, k, ink, owner, bw, bh, i)
    else {
      const g = glyphs.index.get(ch.cp) ?? -1
      stamp(glyphs, g, gx, gy, k, ink, owner, bw, bh, i)
      // A weight the bitmaps do not have is struck twice, a pixel apart.
      if (isBold) stamp(glyphs, g, gx + 1, gy, k, ink, owner, bw, bh, i)
    }
  })

  const tint = (cover: Float32Array, colorAt: (i: number) => Rgb | undefined): void => {
    for (let y = 0; y < bh; y++) {
      const cy = oy + y
      if (cy < 0 || cy >= cv.height) continue
      for (let x = 0; x < bw; x++) {
        const cx = ox + x
        if (cx < 0 || cx >= cv.width) continue
        const i = y * bw + x
        const c = cover[i] as number
        if (c <= 0) continue
        const color = colorAt(i)
        if (color !== undefined) blend(cv.rgba, (cy * cv.width + cx) * 4, color[0], color[1], color[2], c * opacity)
      }
    }
  }
  // The rim goes under the words, in the ground's color, so a line passing behind them never strikes them through.
  if (rim > 0) {
    const halo = dilate(ink, bw, bh, rim)
    const color = colorOf(a.stroke)
    tint(halo, () => color)
  }
  tint(ink, i => chars[owner[i] as number]?.fill)
}

function dilate(ink: Float32Array, bw: number, bh: number, r: number): Float32Array {
  const out = new Float32Array(ink.length)
  const reach = Math.ceil(r + 0.5)
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const c = ink[y * bw + x] as number
      if (c < 0.02) continue
      for (let dy = -reach; dy <= reach; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= bh) continue
        for (let dx = -reach; dx <= reach; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= bw) continue
          const w = Math.min(1, r + 0.5 - Math.hypot(dx, dy))
          if (w <= 0) continue
          const j = yy * bw + xx
          const v = c * w
          if (v > (out[j] as number)) out[j] = v
        }
      }
    }
  }
  return out
}

// ---- frames ----------------------------------------------------------------------------------------

export type Frame = { width: number; height: number; rgba: Uint8Array }

let canvas: Canvas | undefined

/** The largest scale at which the drawing still fits an Image, never above `wanted`. */
export function scaleFor(scene: Scene, wanted: number): number {
  const area = Math.max(1, scene.width * scene.height * 4)
  return Math.min(wanted, Math.floor(Math.sqrt(MAX_IMAGE_BYTES / area) * 100) / 100)
}

/** A run of still shapes painted once, kept as the stretches of each row it covers. */
type Layer = {
  /** Each covered stretch as its first pixel's index and its length, row by row. */
  spans: Int32Array
  /** The stretches' RGBA, one after another. */
  pixels: Uint8ClampedArray
}

/**
 * How a drawing is painted frame after frame. Most of what it draws never moves and costs most of the painting;
 * that is painted once, here, and each frame lays it down between the shapes that move.
 */
type Plan = {
  scene: Scene
  scale: number
  /** The still shapes the drawing begins with, its whole picture so far: copied in, not laid down. */
  base: Uint8ClampedArray | undefined
  steps: ({ layer: Layer } | { shapes: Shape[] })[]
}

let plan: Plan | undefined

const isStill = (shape: Shape): boolean => shape.animations.length === 0 && shape.groups.every(g => g.turns.length === 0)

function layerOf(rgba: Uint8ClampedArray, width: number): Layer {
  const spans: number[] = []
  let covered = 0
  for (let row = 0; row < rgba.length / 4; row += width) {
    for (let x = 0; x < width; ) {
      while (x < width && rgba[(row + x) * 4 + 3] === 0) x++
      const start = x
      while (x < width && rgba[(row + x) * 4 + 3] !== 0) x++
      if (x > start) {
        spans.push(row + start, x - start)
        covered += x - start
      }
    }
  }
  const pixels = new Uint8ClampedArray(covered * 4)
  let o = 0
  for (let k = 0; k < spans.length; k += 2) {
    const from = (spans[k] as number) * 4
    const n = (spans[k + 1] as number) * 4
    pixels.set(rgba.subarray(from, from + n), o)
    o += n
  }
  return { spans: Int32Array.from(spans), pixels }
}

function lay(rgba: Uint8ClampedArray, { spans, pixels }: Layer): void {
  let o = 0
  for (let k = 0; k < spans.length; k += 2) {
    let j = (spans[k] as number) * 4
    const end = j + (spans[k + 1] as number) * 4
    for (; j < end; j += 4, o += 4) {
      const a = pixels[o + 3] as number
      if (a === 255) {
        rgba[j] = pixels[o] as number
        rgba[j + 1] = pixels[o + 1] as number
        rgba[j + 2] = pixels[o + 2] as number
        rgba[j + 3] = 255
      } else blend(rgba, j, pixels[o] as number, pixels[o + 1] as number, pixels[o + 2] as number, a / 255)
    }
  }
}

function planFor(scene: Scene, scale: number, cv: Canvas): Plan {
  const runs: { isStill: boolean; shapes: Shape[] }[] = []
  for (const shape of scene.shapes) {
    const last = runs[runs.length - 1]
    if (last !== undefined && last.isStill === isStill(shape)) last.shapes.push(shape)
    else runs.push({ isStill: isStill(shape), shapes: [shape] })
  }
  const next: Plan = { scene, scale, base: undefined, steps: [] }
  for (const [k, run] of runs.entries()) {
    if (!run.isStill) {
      next.steps.push({ shapes: run.shapes })
      continue
    }
    cv.rgba.fill(0)
    for (const shape of run.shapes) paintShape(cv, shape, 0, scale)
    if (k === 0) next.base = cv.rgba.slice()
    else next.steps.push({ layer: layerOf(cv.rgba, cv.width) })
  }
  return next
}

/**
 * The drawing as it looks `t` ms after it was made, at `scale` pixels to its unit.
 * The frame's pixels are reused by the next paint: send or copy them first.
 */
export function paint(scene: Scene, t: number, scale: number): Frame {
  const width = Math.max(1, Math.round(scene.width * scale))
  const height = Math.max(1, Math.round(scene.height * scale))
  if (canvas === undefined || canvas.width !== width || canvas.height !== height) canvas = new Canvas(width, height)
  if (plan === undefined || plan.scene !== scene || plan.scale !== scale) plan = planFor(scene, scale, canvas)
  if (plan.base !== undefined) canvas.rgba.set(plan.base)
  else canvas.rgba.fill(0)
  for (const step of plan.steps) {
    if ('layer' in step) lay(canvas.rgba, step.layer)
    else for (const shape of step.shapes) paintShape(canvas, shape, t, scale)
  }
  return { width, height, rgba: new Uint8Array(canvas.rgba.buffer, canvas.rgba.byteOffset, canvas.rgba.byteLength) }
}
