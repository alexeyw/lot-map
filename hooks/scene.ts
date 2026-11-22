// The drawing drawMap makes, read: a small, known part of SVG taken apart into shapes, with where each animation
// stands at a given moment. `raster.ts` paints what this file reads. Nothing here touches the engine.

export type Point = { x: number; y: number }


// ---- the drawing, read --------------------------------------------------------------------------

type Timing = { begin: number; dur: number; repeat: number; freeze: boolean }
type ValueAnimation = Timing & { kind: 'value'; attr: string; values: number[]; keyTimes: number[] | undefined }
type MotionAnimation = Timing & { kind: 'motion'; from: Point; to: Point }
type TurnAnimation = Timing & { kind: 'turn'; from: number[]; to: number[] }
export type Animation = ValueAnimation | MotionAnimation | TurnAnimation

type Run = { text: string; fill: string | undefined }
export type Sub = { points: Point[]; closed: boolean }
/** A group's own transform, and its turns, which take its place while they run, as in SVG. */
type Group = { matrix: Matrix; turns: Animation[] }

export type Shape = {
  tag: 'rect' | 'ellipse' | 'circle' | 'line' | 'path' | 'text'
  attrs: Readonly<Record<string, string>>
  /** Its own animations, the latest to begin last: a later one overrides an earlier one, as in SVG. */
  animations: Animation[]
  /** The groups it sits in, innermost first. */
  groups: Group[]
  runs: Run[]
  /** A path's outline, read once. */
  subs?: Sub[]
}

export type Scene = {
  width: number
  height: number
  shapes: Shape[]
  /** What the reader met and cannot paint: an element, an attribute or a value. Empty for every drawing drawMap makes. */
  unknown: string[]
}

const PAINT = ['fill', 'stroke', 'stroke-width', 'opacity', 'stroke-dasharray', 'stroke-dashoffset', 'pathLength', 'stroke-linecap', 'stroke-linejoin', 'transform']
const KNOWN: Readonly<Record<string, readonly string[]>> = {
  svg: ['xmlns', 'role', 'viewBox', 'width', 'height'],
  g: ['transform'],
  style: [],
  rect: ['x', 'y', 'width', 'height', 'rx', ...PAINT],
  ellipse: ['cx', 'cy', 'rx', 'ry', ...PAINT],
  circle: ['cx', 'cy', 'r', ...PAINT],
  line: ['x1', 'y1', 'x2', 'y2', ...PAINT],
  path: ['d', ...PAINT],
  text: ['x', 'y', 'text-anchor', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'paint-order', ...PAINT],
  tspan: ['fill'],
  animate: ['attributeName', 'values', 'keyTimes', 'begin', 'dur', 'fill', 'repeatCount'],
  animateMotion: ['path', 'begin', 'dur', 'fill', 'repeatCount'],
  animateTransform: ['attributeName', 'type', 'from', 'to', 'begin', 'dur', 'fill', 'repeatCount'],
}
const ANIMATED = new Set(['opacity', 'r', 'stroke-dashoffset'])
const COLORED = ['fill', 'stroke']

const TOKEN = /<(\/?)([A-Za-z]+)((?:\s+[A-Za-z][\w:-]*="[^"]*")*)\s*(\/?)>|([^<]+)/g
const ATTRIBUTE = /([A-Za-z][\w:-]*)="([^"]*)"/g

export const num = (v: string | undefined, fallback: number): number => {
  const n = v === undefined ? NaN : Number.parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}
export const numbers = (v: string | undefined): number[] => (v ?? '').split(/[\s,;]+/).filter(x => x !== '').map(x => Number.parseFloat(x)).filter(Number.isFinite)
const ms = (v: string | undefined): number => (v === undefined ? 0 : v.endsWith('ms') ? num(v, 0) : num(v, 0) * 1000)

function decode(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, name: string) => {
    const lower = name.toLowerCase()
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16))
    if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10))
    return ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[lower] ?? ''
  })
}

function timing(attrs: Record<string, string>): Timing {
  const count = attrs.repeatCount
  return {
    begin: ms(attrs.begin),
    dur: Math.max(0, ms(attrs.dur)),
    repeat: count === 'indefinite' ? Infinity : count === undefined ? 1 : Math.max(0, num(count, 1)),
    freeze: attrs.fill === 'freeze',
  }
}

function animation(tag: string, attrs: Record<string, string>, flag: (what: string) => undefined): Animation | undefined {
  if (tag === 'animate') {
    const attr = attrs.attributeName ?? ''
    if (!ANIMATED.has(attr)) return flag(`animate ${attr}`)
    const keyTimes = attrs.keyTimes === undefined ? undefined : numbers(attrs.keyTimes)
    return { kind: 'value', attr, values: numbers(attrs.values), keyTimes, ...timing(attrs) }
  }
  if (tag === 'animateMotion') {
    const m = /^M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*L\s*(-?[\d.]+)[\s,]+(-?[\d.]+)$/.exec((attrs.path ?? '').trim())
    if (m === null) return flag(`animateMotion path ${attrs.path}`)
    const [x1, y1, x2, y2] = m.slice(1).map(Number) as [number, number, number, number]
    return { kind: 'motion', from: { x: x1, y: y1 }, to: { x: x2, y: y2 }, ...timing(attrs) }
  }
  if (attrs.type !== 'rotate' || attrs.attributeName !== 'transform') return flag(`animateTransform ${attrs.type}`)
  return { kind: 'turn', from: numbers(attrs.from), to: numbers(attrs.to), ...timing(attrs) }
}

/** Reads a drawing made by drawMap. Anything it cannot paint lands in `unknown` and is otherwise left out. */
export function parseMap(svg: string): Scene {
  const scene: Scene = { width: 0, height: 0, shapes: [], unknown: [] }
  const flag = (what: string): undefined => {
    if (!scene.unknown.includes(what)) scene.unknown.push(what)
    return undefined
  }
  type Open = { tag: string; shape?: Shape; group?: Group; fill?: string }
  const stack: Open[] = []
  let inStyle = false

  for (const m of svg.matchAll(TOKEN)) {
    const [, closing, tag = '', rawAttrs = '', selfClosing, text] = m
    if (text !== undefined) {
      if (inStyle) continue
      const owner = [...stack].reverse().find(f => f.shape?.tag === 'text')?.shape
      const top = stack[stack.length - 1]
      if (owner !== undefined) owner.runs.push({ text: decode(text), fill: top?.tag === 'tspan' ? top.fill : undefined })
      continue
    }
    if (closing === '/') {
      if (tag === 'style') inStyle = false
      const at = stack.map(f => f.tag).lastIndexOf(tag)
      if (at >= 0) stack.length = at
      continue
    }

    const attrs: Record<string, string> = {}
    for (const [, name = '', value = ''] of rawAttrs.matchAll(ATTRIBUTE)) attrs[name] = value
    const known = KNOWN[tag]
    if (known === undefined) {
      flag(`<${tag}>`)
      continue
    }
    for (const name of Object.keys(attrs)) if (!known.includes(name)) flag(`${tag} ${name}`)
    // On an animation `fill` says whether it holds its last value, not a color.
    for (const name of tag.startsWith('animate') ? [] : COLORED) {
      const v = attrs[name]
      if (v !== undefined && v !== 'none' && colorOf(v) === undefined) flag(`${tag} ${name}=${v}`)
    }
    if (attrs.transform !== undefined && transformOf(attrs.transform) === undefined) flag(`transform ${attrs.transform}`)
    if (attrs['stroke-linecap'] !== undefined && !['butt', 'round'].includes(attrs['stroke-linecap'])) flag(`stroke-linecap ${attrs['stroke-linecap']}`)

    let pushed: Open | undefined
    switch (tag) {
      case 'svg': {
        const box = numbers(attrs.viewBox)
        scene.width = box[2] ?? num(attrs.width, 0)
        scene.height = box[3] ?? num(attrs.height, 0)
        pushed = { tag }
        break
      }
      case 'style':
        inStyle = selfClosing !== '/'
        break
      case 'g':
        pushed = { tag, group: { matrix: transformOf(attrs.transform) ?? IDENTITY, turns: [] } }
        break
      case 'tspan':
        pushed = { tag, ...(attrs.fill !== undefined ? { fill: attrs.fill } : {}) }
        break
      case 'animate':
      case 'animateMotion':
      case 'animateTransform': {
        const top = stack[stack.length - 1]
        const made = animation(tag, attrs, flag)
        if (made === undefined) break
        if (made.kind === 'turn') {
          if (top?.group !== undefined) top.group.turns.push(made)
          else flag('animateTransform outside a group')
        } else if (top?.shape !== undefined) top.shape.animations.push(made)
        else flag(`${tag} outside a shape`)
        break
      }
      default: {
        const shapeTag = tag as Shape['tag']
        if ((shapeTag === 'path' || shapeTag === 'ellipse') && (attrs.fill ?? 'black') !== 'none') flag(`${tag} filled`)
        if (shapeTag === 'text' && attrs.stroke !== undefined && attrs['paint-order'] !== 'stroke') flag('text stroked over its fill')
        const groups = stack.filter(f => f.group !== undefined).map(f => f.group as Group).reverse()
        const shape: Shape = { tag: shapeTag, attrs, animations: [], groups, runs: [] }
        if (shapeTag === 'path') shape.subs = pathOf(attrs.d ?? '', flag)
        scene.shapes.push(shape)
        pushed = { tag, shape }
      }
    }
    if (pushed !== undefined && selfClosing !== '/') stack.push(pushed)
  }
  // A later begin takes over from an earlier one; the sort keeps document order between equals.
  for (const shape of scene.shapes) shape.animations.sort((a, b) => a.begin - b.begin)
  return scene
}

// ---- outlines ------------------------------------------------------------------------------------

/** How finely curves are cut into straight pieces, in the drawing's own units. */
const STEP = 0.8

function cut(length: number): number {
  return Math.max(6, Math.min(96, Math.ceil(length / STEP)))
}

function arcTo(out: Point[], p0: Point, rxIn: number, ryIn: number, phiDeg: number, large: boolean, sweep: boolean, p1: Point): void {
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx === 0 || ry === 0 || (p0.x === p1.x && p0.y === p1.y)) {
    out.push(p1)
    return
  }
  const phi = (phiDeg * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (p0.x - p1.x) / 2
  const dy = (p0.y - p1.y) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const top = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const bottom = rx * rx * y1 * y1 + ry * ry * x1 * x1
  let k = Math.sqrt(Math.max(0, top / bottom))
  if (large === sweep) k = -k
  const cxp = (k * rx * y1) / ry
  const cyp = (-k * ry * x1) / rx
  const cx = cos * cxp - sin * cyp + (p0.x + p1.x) / 2
  const cy = sin * cxp + cos * cyp + (p0.y + p1.y) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number): number => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const start = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry)
  let delta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  else if (sweep && delta < 0) delta += 2 * Math.PI
  const n = cut(Math.abs(delta) * Math.max(rx, ry))
  for (let i = 1; i <= n; i++) {
    const a = start + (delta * i) / n
    const ex = rx * Math.cos(a)
    const ey = ry * Math.sin(a)
    out.push(i === n ? p1 : { x: cx + ex * cos - ey * sin, y: cy + ex * sin + ey * cos })
  }
}

function curveTo(out: Point[], pts: Point[]): void {
  let length = 0
  for (let i = 1; i < pts.length; i++) length += Math.hypot((pts[i] as Point).x - (pts[i - 1] as Point).x, (pts[i] as Point).y - (pts[i - 1] as Point).y)
  const n = cut(length)
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    if (pts.length === 3) {
      const [a, b, c] = pts as [Point, Point, Point]
      out.push({ x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, y: u * u * a.y + 2 * u * t * b.y + t * t * c.y })
    } else {
      const [a, b, c, d] = pts as [Point, Point, Point, Point]
      out.push({
        x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
        y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
      })
    }
  }
}

const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, S: 4, A: 7, Z: 0 }

/** A path's `d` as straight pieces: M L H V Q C S A Z, absolute and relative. */
function pathOf(d: string, flag: (what: string) => void): Sub[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? []
  const subs: Sub[] = []
  let current: Sub | undefined
  let at: Point = { x: 0, y: 0 }
  let start: Point = at
  let control: Point | undefined
  let i = 0
  let command = ''
  const take = (): number => Number(tokens[i++])
  while (i < tokens.length) {
    const token = tokens[i] as string
    if (/[a-zA-Z]/.test(token)) {
      command = token
      i++
      if (ARITY[command.toUpperCase()] === undefined) {
        flag(`path command ${command}`)
        return subs
      }
    } else if (command === '') {
      flag('path without a command')
      return subs
    }
    const upper = command.toUpperCase()
    const rel = command !== upper
    if (upper === 'Z') {
      if (current !== undefined) current.closed = true
      at = start
      current = undefined
      control = undefined
      continue
    }
    if (i + (ARITY[upper] as number) > tokens.length) break
    const ox = rel ? at.x : 0
    const oy = rel ? at.y : 0
    if (upper === 'M') {
      at = { x: ox + take(), y: oy + take() }
      start = at
      current = { points: [at], closed: false }
      subs.push(current)
      control = undefined
      command = rel ? 'l' : 'L'
      continue
    }
    if (current === undefined) {
      current = { points: [at], closed: false }
      subs.push(current)
    }
    const pts = current.points
    let nextControl: Point | undefined
    switch (upper) {
      case 'L':
        at = { x: ox + take(), y: oy + take() }
        pts.push(at)
        break
      case 'H':
        at = { x: ox + take(), y: at.y }
        pts.push(at)
        break
      case 'V':
        at = { x: at.x, y: oy + take() }
        pts.push(at)
        break
      case 'Q': {
        const c: Point = { x: ox + take(), y: oy + take() }
        const end: Point = { x: ox + take(), y: oy + take() }
        curveTo(pts, [at, c, end])
        at = end
        break
      }
      case 'C': {
        const c1: Point = { x: ox + take(), y: oy + take() }
        const c2: Point = { x: ox + take(), y: oy + take() }
        const end: Point = { x: ox + take(), y: oy + take() }
        curveTo(pts, [at, c1, c2, end])
        nextControl = c2
        at = end
        break
      }
      case 'S': {
        const c1: Point = control === undefined ? at : { x: 2 * at.x - control.x, y: 2 * at.y - control.y }
        const c2: Point = { x: ox + take(), y: oy + take() }
        const end: Point = { x: ox + take(), y: oy + take() }
        curveTo(pts, [at, c1, c2, end])
        nextControl = c2
        at = end
        break
      }
      case 'A': {
        const rx = take()
        const ry = take()
        const phi = take()
        const large = take() !== 0
        const sweep = take() !== 0
        const end: Point = { x: ox + take(), y: oy + take() }
        arcTo(pts, at, rx, ry, phi, large, sweep, end)
        at = end
        break
      }
    }
    control = nextControl
  }
  return subs
}

export function ellipseOf(cx: number, cy: number, rx: number, ry: number): Sub {
  // As SVG has it: from three o'clock, the way the angle grows, which on a screen is clockwise.
  const n = Math.max(24, Math.min(360, Math.ceil((2 * Math.PI * Math.max(rx, ry)) / STEP)))
  const points: Point[] = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    points.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) })
  }
  return { points, closed: true }
}

export const lengthOf = (sub: Sub): number => {
  let length = 0
  const pts = sub.closed ? [...sub.points, sub.points[0] as Point] : sub.points
  for (let i = 1; i < pts.length; i++) length += Math.hypot((pts[i] as Point).x - (pts[i - 1] as Point).x, (pts[i] as Point).y - (pts[i - 1] as Point).y)
  return length
}

/** The dashes of a dash pattern along each piece, as open pieces of their own. */
export function dashed(subs: readonly Sub[], pattern: readonly number[], offset: number): Sub[] {
  const array = pattern.length % 2 === 1 ? [...pattern, ...pattern] : [...pattern]
  const period = array.reduce((a, b) => a + b, 0)
  if (array.length === 0 || period <= 0 || array.some(v => v < 0)) return [...subs]
  const out: Sub[] = []
  for (const sub of subs) {
    const pts = sub.closed ? [...sub.points, sub.points[0] as Point] : sub.points
    let phase = ((offset % period) + period) % period
    let index = 0
    while (phase >= (array[index] as number)) {
      phase -= array[index] as number
      index = (index + 1) % array.length
    }
    let left = (array[index] as number) - phase
    let isOn = index % 2 === 0
    let piece: Point[] | undefined = isOn ? [pts[0] as Point] : undefined
    let pieceLength = 0
    const close = (): void => {
      if (piece !== undefined && piece.length > 1 && pieceLength > 1e-3) out.push({ points: piece, closed: false })
      piece = undefined
      pieceLength = 0
    }
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1] as Point
      const b = pts[k] as Point
      const length = Math.hypot(b.x - a.x, b.y - a.y)
      let done = 0
      while (length - done > left) {
        done += left
        const q: Point = { x: a.x + ((b.x - a.x) * done) / length, y: a.y + ((b.y - a.y) * done) / length }
        if (isOn) {
          piece?.push(q)
          pieceLength += left
          close()
        } else {
          piece = [q]
        }
        isOn = !isOn
        index = (index + 1) % array.length
        left = array[index] as number
      }
      left -= length - done
      if (isOn && piece !== undefined) {
        piece.push(b)
        pieceLength += length - done
      }
    }
    close()
  }
  return out
}

// ---- time ----------------------------------------------------------------------------------------

/** How far into its pass an animation is at `t`, 0 to 1; undefined when it does not apply. */
export function progress(a: Timing, t: number): number | undefined {
  if (t < a.begin) return undefined
  const local = t - a.begin
  const total = a.repeat * a.dur
  if (local >= total || a.dur === 0) return a.freeze || a.dur === 0 ? 1 : undefined
  return (local % a.dur) / a.dur
}

function interpolate(values: readonly number[], keyTimes: readonly number[] | undefined, p: number): number {
  if (values.length === 0) return 0
  if (values.length === 1) return values[0] as number
  const n = values.length - 1
  if (keyTimes !== undefined && keyTimes.length === values.length) {
    for (let i = 0; i < n; i++) {
      const k0 = keyTimes[i] as number
      const k1 = keyTimes[i + 1] as number
      if (p <= k1 || i === n - 1) {
        const f = k1 > k0 ? Math.min(1, Math.max(0, (p - k0) / (k1 - k0))) : 1
        return (values[i] as number) + ((values[i + 1] as number) - (values[i] as number)) * f
      }
    }
  }
  const at = Math.min(p * n, n)
  const i = Math.min(Math.floor(at), n - 1)
  return (values[i] as number) + ((values[i + 1] as number) - (values[i] as number)) * (at - i)
}

/** An animated attribute's value at `t`: its own value until an animation applies, then the latest animation's. */
export function valueAt(shape: Shape, attr: string, base: number, t: number): number {
  let v = base
  for (const a of shape.animations) {
    if (a.kind !== 'value' || a.attr !== attr) continue
    const p = progress(a, t)
    if (p !== undefined) v = interpolate(a.values, a.keyTimes, p)
  }
  return v
}

/**
 * The quickest the map is painted again, in ms: five frames a second. It was thirty at first, and in kitty 0.50 none
 * of those reached the screen while the map moved: of twenty shots of the window taken while a command ran, none
 * showed a map at 33, 66 or 125 ms a frame, and all twenty did at 200 (2026-11-18, macOS; PRINCIPLES.md has it).
 * It is how much is sent in a second that counts, not how often (issue #110): `SENT_A_SECOND` in terminal.tsx holds
 * the picture under that, and may make a large frame wait longer than this.
 */
export const FASTEST_MS = 200

/** How long after a drawing is made its endless animations move smoothly while something runs: the core's breath, and the beat and the hands of what runs. */
export const ENDLESS_FOR_MS = 600_000
/** After that, the frame interval while something still runs: a task left for hours paints little. */
const ENDLESS_LATER_MS = 5000

/** How often the endless animations of a drawing `t` ms old may get a frame: only while something runs, freely for ten minutes, then every 5 s. */
export function endlessEvery(t: number, isBusy: boolean): number | undefined {
  if (!isBusy) return undefined
  return t < ENDLESS_FOR_MS ? FASTEST_MS : ENDLESS_LATER_MS
}

/** How often an animation of this length wants a frame: five a second for a pulse, a glow or a breath; rarely for the clock hands. */
const everyFor = (dur: number): number => (dur <= 10_000 ? FASTEST_MS : Math.min(10_000, Math.max(1000, dur / 60)))

/** How long until the drawing next looks different, in ms, or undefined if it never will. Endless animations count only given `endlessEvery`. */
export function nextChangeIn(scene: Scene, t: number, endlessEvery?: number): number | undefined {
  let soonest = Infinity
  for (const shape of scene.shapes) {
    for (const a of [...shape.animations, ...shape.groups.flatMap(g => g.turns)]) {
      const isEndless = a.repeat === Infinity
      if (isEndless && endlessEvery === undefined) continue
      if (t < a.begin) soonest = Math.min(soonest, a.begin - t)
      else if (t < a.begin + a.repeat * a.dur) soonest = Math.min(soonest, isEndless ? Math.max(endlessEvery ?? 0, everyFor(a.dur)) : everyFor(a.dur))
    }
  }
  return soonest === Infinity ? undefined : Math.max(FASTEST_MS, soonest)
}

// ---- colours and places ----------------------------------------------------------------------------

export type Rgb = [number, number, number]

export function colorOf(v: string | undefined): Rgb | undefined {
  const hex = /^#(?:([0-9a-f]{3})|([0-9a-f]{6}))$/i.exec(v ?? '')
  if (hex === null) return undefined
  const full = hex[1] !== undefined ? [...hex[1]].map(c => c + c).join('') : (hex[2] as string)
  return [Number.parseInt(full.slice(0, 2), 16), Number.parseInt(full.slice(2, 4), 16), Number.parseInt(full.slice(4, 6), 16)]
}

export type Matrix = [number, number, number, number, number, number]

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export function rotation(degrees: number, cx: number, cy: number): Matrix {
  const a = (degrees * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]
}

export function transformOf(v: string | undefined): Matrix | undefined {
  let m = IDENTITY
  if (v === undefined) return m
  const rest = v.replace(/(translate|rotate)\(([^)]*)\)/g, (_, kind: string, args: string) => {
    const n = numbers(args)
    const next: Matrix = kind === 'translate' ? [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0] : rotation(n[0] ?? 0, n[1] ?? 0, n[2] ?? 0)
    m = [
      m[0] * next[0] + m[2] * next[1],
      m[1] * next[0] + m[3] * next[1],
      m[0] * next[2] + m[2] * next[3],
      m[1] * next[2] + m[3] * next[3],
      m[0] * next[4] + m[2] * next[5] + m[4],
      m[1] * next[4] + m[3] * next[5] + m[5],
    ]
    return ''
  })
  return rest.trim() === '' ? m : undefined
}
