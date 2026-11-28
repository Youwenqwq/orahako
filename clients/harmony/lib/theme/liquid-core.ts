/**
 * Pure geometry / phase / path math for the liquid theme reveal.
 *
 * The module never touches the DOM so the whole timeline can be unit-tested
 * in Node: a frame is fully determined by (geometry, timeline, elapsed) and
 * returns the SVG path data plus the currently entered phase index.
 */

export type LiquidAppearance = "light" | "dark"
export type LiquidDirection = "to-dark" | "to-light"

/** Visual stages of the reveal, in strict order. */
export type LiquidPhase = "stream" | "splash" | "rise" | "settle"

export const LIQUID_PHASES: readonly LiquidPhase[] = ["stream", "splash", "rise", "settle"]

export type LiquidAbortReason =
  | "superseded" // a newer user request replaced the running transition
  | "external-theme" // theme changed outside this flow (system / cross-tab)
  | "geometry" // viewport resized or rotated
  | "hidden" // page went to the background
  | "timeout" // animation frames stopped before the viewport was filled
  | "unmount"
  | "manual"

export interface LiquidOrigin {
  x: number
  y: number
}

export interface LiquidGeometry {
  width: number
  height: number
  originX: number
  originY: number
}

export interface LiquidTimeline {
  /** Column pours from the button down to the viewport bottom. */
  stream: number
  /** Impact fan + ripples; the contact spray decays as the level climbs. */
  splash: number
  /** Pooled water rises to fill the viewport with an undulating wave. */
  rise: number
  /** Wave amplitude decays before the real theme is committed. */
  settle: number
}

export interface LiquidFrame {
  /** SVG path data for `clipPath` — every subpath is wound clockwise so the
   * default nonzero fill rule unions column, droplets, splash and water. */
  d: string
  /** Conservative bottom edge of the visible liquid, in viewport CSS pixels. */
  bottom: number
  /** Index into `LIQUID_PHASES` of the phase in progress. */
  phaseIndex: number
  done: boolean
  /** Whether the bottom water body exists yet. */
  water: boolean
  /** Whether the water covers the entire viewport, including the last trough. */
  covered: boolean
}

export const DEFAULT_LIQUID_DURATION = 2400
const MAX_FRAME_ADVANCE_MS = 50
const COLUMN_TIP_CAP_RATIO = 1.55

export function liquidDirection(target: LiquidAppearance): LiquidDirection {
  return target === "dark" ? "to-dark" : "to-light"
}

/** Fractional split of the total duration across the four phases. */
export function planTimeline(duration: number): LiquidTimeline {
  const total = Math.min(2400, Math.max(700, duration))
  return {
    stream: total * 0.3,
    splash: total * 0.14,
    rise: total * 0.51,
    settle: total * 0.05,
  }
}

/**
 * Quadratic splash decay: S = S_max·(1-h)². `h` is the water level normalized
 * from `startLevel` (first contact — full splash) to `stopLevel` (the nozzle —
 * nothing falls anymore), so the remaining splash fraction is (1-h)²: 25% at
 * mid-climb, 1% at 90%, exactly 0 at the nozzle, with a zero end slope so the
 * spray fades away instead of vanishing mid-air. Launch height and particle
 * density reuse k directly; spread and drop size reuse t = √k.
 */
export function splashDecay(level: number, startLevel: number, stopLevel: number): number {
  const span = startLevel - stopLevel
  if (!(span > 0) || !Number.isFinite(span) || !Number.isFinite(level)) return 0
  const h = clamp01((startLevel - level) / span)
  const remaining = 1 - h
  return remaining * remaining
}

/**
 * Clamp an origin into the viewport. When no control was found the stream
 * falls in from the top center so the animation still reads as liquid.
 */
export function clampOrigin(
  origin: LiquidOrigin | null | undefined,
  width: number,
  height: number
): LiquidOrigin {
  if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) {
    return { x: width / 2, y: -12 }
  }
  return {
    x: Math.min(Math.max(origin.x, 8), Math.max(8, width - 8)),
    y: Math.min(Math.max(origin.y, -40), Math.max(8, height - 8)),
  }
}

/**
 * Abort policy: the accepted target theme is committed when the transition
 * dies for local reasons, but an externally applied theme always wins.
 */
export function shouldCommitOnAbort(reason: LiquidAbortReason): boolean {
  switch (reason) {
    case "external-theme":
    case "superseded":
      return false
    default:
      return true
  }
}

function f2(n: number): string {
  const r = Math.round(n * 100) / 100
  return Number.isFinite(r) ? String(r) : "0"
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function easeInQuad(n: number): number {
  return n * n
}

function smoothStep(n: number): number {
  const progress = clamp01(n)
  return progress * progress * (3 - 2 * progress)
}

/** Preserve the intermediate frames after a main-thread stall or touch gesture. */
export function advanceLiquidElapsed(elapsed: number, frameGap: number): number {
  return elapsed + Math.max(0, Math.min(MAX_FRAME_ADVANCE_MS, frameGap))
}

/** Deterministic pseudo-random fraction in [0, 1) so frames stay pure. */
function hash01(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return value - Math.floor(value)
}

/** Limit the tangents so each segment stays between its endpoints. */
function smoothTangents(values: readonly number[], positions?: readonly number[]): number[] {
  const slopes = values.slice(1).map((value, i) => {
    const step = positions ? positions[i + 1] - positions[i] : 1
    return (value - values[i]) / step
  })
  return values.map((_, i) => {
    if (i === 0) return slopes[0]
    if (i === values.length - 1) return slopes[i - 1]
    const before = slopes[i - 1]
    const after = slopes[i]
    return before * after > 0 ? (2 * before * after) / (before + after) : 0
  })
}

function cubicTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): string {
  return `C${f2(x1)} ${f2(y1)} ${f2(x2)} ${f2(y2)} ${f2(x)} ${f2(y)}`
}

function cubicValue(a: number, b: number, c: number, d: number, u: number): number {
  const v = 1 - u
  return a * v ** 3 + 3 * b * v * v * u + 3 * c * v * u * u + d * u ** 3
}

/** Clockwise circle subpath (matches the winding of the other subpaths). */
function circle(cx: number, cy: number, r: number): string {
  if (r <= 0.2) return ""
  return (
    `M${f2(cx - r)} ${f2(cy)}` +
    `a${f2(r)} ${f2(r)} 0 1 1 ${f2(r * 2)} 0` +
    `a${f2(r)} ${f2(r)} 0 1 1 ${f2(-r * 2)} 0Z`
  )
}

interface Droplet {
  spawnAt: number
  landAt: number | null
  x: number
  y: number
  vx: number
  vy0: number
  radius: number
}

interface Ripple {
  at: number
  weights: number[]
}

interface SplashParticle {
  spawnAt: number
  landAt: number
  x: number
  y: number
  vx: number
  vy0: number
  radius: number
}

interface WaterSurface {
  heights: number[]
  tangents: number[]
  shift: number
  covered: boolean
}

interface ColumnProfile {
  heights: number[]
  centres: number[]
  widths: number[]
  centreSlopes: number[]
  widthSlopes: number[]
}

const GRAVITY = 0.0026 // px per ms²
const SPLASH_GRAVITY = 0.0036

const TOP_APPROACH_PX = 80
const FILL_MARGIN_PX = 1

export interface LiquidSequence {
  frame(elapsed: number): LiquidFrame
  /** Impact moment of the column tip (ms). */
  impactAt: number
  /** Total duration (ms). */
  total: number
}

export function createLiquidSequence(
  geometry: LiquidGeometry,
  timeline: LiquidTimeline = planTimeline(DEFAULT_LIQUID_DURATION)
): LiquidSequence {
  const W = Math.max(1, geometry.width)
  const H = Math.max(1, geometry.height)
  const origin = clampOrigin({ x: geometry.originX, y: geometry.originY }, W, H)
  const ox = origin.x
  const oy = Math.max(0, Math.min(origin.y, H))

  const impact = timeline.stream
  const riseStart = impact + timeline.splash
  const total = riseStart + timeline.rise + timeline.settle
  const poolDepth = Math.min(10, H * 0.25)
  const filledPath = `M0 0L${f2(W)} 0L${f2(W)} ${f2(H)}L0 ${f2(H)}Z`

  const baseWidth = Math.min(26, Math.max(12, W * 0.018))
  const nozzleHalfWidth = baseWidth * 0.31
  const nozzleLip = baseWidth * 0.14
  const nozzleY = oy + nozzleLip
  const maxSplashHeight = Math.max(0, Math.min(60, H - nozzleY))
  const maxSplashSpeed = Math.sqrt(2 * SPLASH_GRAVITY * maxSplashHeight)
  const surfaceSegments = Math.min(36, Math.ceil(W / 28))
  const surfaceStep = W / surfaceSegments
  const surfaceXs = Array.from({ length: surfaceSegments + 1 }, (_, i) => i * surfaceStep)

  function columnCentre(y: number, t: number): number {
    const flex = smoothStep((y - nozzleY) / 48)
    return ox + 4 * flex * Math.sin(y / 88 - t * 0.017)
  }

  // Droplets can detach from the moving tip.
  const droplets: Droplet[] = [0.44, 0.57, 0.7].map((fraction, i) => {
    const side = i % 2 === 0 ? 1 : -1
    const spawnAt = impact * fraction
    const y = Math.min(H, columnTip(spawnAt))
    return {
      spawnAt,
      landAt: null,
      x: columnCentre(y, spawnAt) + side * 4,
      y,
      vx: side * (0.14 + 0.08 * i),
      vy0: 0.16 + 0.04 * i,
      radius: 3 + (i % 3),
    }
  })

  const impactX = columnCentre(H, impact)

  const ripples: Ripple[] = []

  function addRipple(x: number, at: number, amplitude: number): void {
    const sigma = 34
    const weights = surfaceXs.map(
      (sampleX) => amplitude * Math.exp(-((sampleX - x) ** 2) / (2 * sigma * sigma))
    )
    ripples.push({ at, weights })
  }

  function waterDepth(t: number): number {
    if (t < impact) return 0
    if (t < riseStart) {
      // A thin pool gathers at the bottom edge during the splash phase.
      return poolDepth * smoothStep((t - impact) / Math.max(1, timeline.splash))
    }
    const progress = clamp01((t - riseStart) / Math.max(1, timeline.rise))
    return poolDepth + (H + 2 * FILL_MARGIN_PX - poolDepth) * progress
  }

  function waveAmplitude(t: number): number {
    if (t < impact) return 0
    if (t < riseStart) {
      const splash = (t - impact) / Math.max(1, timeline.splash)
      return 10 * smoothStep(splash)
    }
    return 10 + 2 * smoothStep(((t - riseStart) * 2) / Math.max(1, timeline.rise))
  }

  function columnTip(t: number): number {
    if (t >= impact) return H + 24
    const p = clamp01(t / Math.max(1, impact))
    return oy + (H + 24 - oy) * easeInQuad(p)
  }

  function rippleOffsets(t: number): number[] {
    const offsets = surfaceXs.map(() => 0)
    for (const ripple of ripples) {
      const age = t - ripple.at
      if (age < 0) continue
      const oscillation = Math.cos(age * 0.02)
      const envelope = smoothStep(age / 42) * Math.exp(-age / 240)
      for (let i = 0; i < offsets.length; i++) {
        offsets[i] += ripple.weights[i] * oscillation * envelope
      }
    }
    return offsets
  }

  function impactLift(t: number, strength: number): number {
    return (
      (11 + 3 * Math.sin(t * 0.021) + 2.4 * Math.sin(t * 0.049 + 1.6)) *
      smoothStep((t - impact) / 65) *
      strength
    )
  }

  function dropletPosition(droplet: Droplet, t: number): { x: number; y: number } | null {
    const age = t - droplet.spawnAt
    if (age < 0) return null
    if (droplet.landAt !== null && t >= droplet.landAt) return null
    const x = droplet.x + droplet.vx * age
    const y = droplet.y + droplet.vy0 * age + 0.5 * GRAVITY * age * age
    return { x, y }
  }

  // Precompute droplet landing times against the rising water line so each
  // droplet spawns exactly one ripple, deterministically.
  for (const droplet of droplets) {
    for (let t = droplet.spawnAt + 16; t <= total; t += 16) {
      const pos = dropletPosition({ ...droplet, landAt: null }, t)
      if (!pos) continue
      const ground = t < impact ? H : surfaceAt(waterSurface(t), pos.x)
      if (pos.y >= ground) {
        droplet.landAt = t
        addRipple(pos.x, t, 5)
        break
      }
    }
    if (droplet.landAt === null) droplet.landAt = total + 1
  }
  addRipple(impactX, impact, 8)
  addRipple(impactX - 42, impact + 66, 4)
  addRipple(impactX + 42, impact + 91, 3)

  function waterSurface(t: number, strength?: number): WaterSurface {
    const level = H - waterDepth(t)
    const amplitude = waveAmplitude(t)
    const feedX = columnCentre(level, t)
    const feed = impactLift(t, strength ?? splashDecay(level, H, nozzleY))
    const offsets = rippleOffsets(t)
    const heights = surfaceXs.map((x, i) => {
      const wave =
        amplitude * (0.6 * Math.sin(x / 93 + t * 0.0055) + 0.4 * Math.sin(x / 47 - t * 0.0042))
      const column = feed * Math.exp(-((x - feedX) ** 2) / (2 * 38 * 38))
      return level - wave - offsets[i] - column
    })
    const trough = Math.max(...heights)
    // Guide the lowest point of the wave to the top edge while retaining its shape.
    const approach = 1 - clamp01(level / TOP_APPROACH_PX)
    const shift = (level - trough) * approach
    return {
      heights,
      tangents: smoothTangents(heights),
      shift,
      covered: trough + shift <= -FILL_MARGIN_PX,
    }
  }

  function surfaceAt({ heights, tangents, shift }: WaterSurface, x: number): number {
    const sample = Math.max(0, Math.min(surfaceSegments, x / surfaceStep))
    const i = Math.min(Math.floor(sample), surfaceSegments - 1)
    return (
      cubicValue(
        heights[i],
        heights[i] + tangents[i] / 3,
        heights[i + 1] - tangents[i + 1] / 3,
        heights[i + 1],
        sample - i
      ) + shift
    )
  }

  function waterPath({ heights, tangents, shift }: WaterSurface): string {
    let d = `M0 ${f2(H)}L0 ${f2(heights[0] + shift)}`
    for (let i = 0; i < surfaceSegments; i++) {
      const a = heights[i] + shift
      const b = heights[i + 1] + shift
      d += cubicTo(
        surfaceXs[i] + surfaceStep / 3,
        a + tangents[i] / 3,
        surfaceXs[i + 1] - surfaceStep / 3,
        b - tangents[i + 1] / 3,
        surfaceXs[i + 1],
        b
      )
    }
    return d + `L${f2(W)} ${f2(H)}Z`
  }

  function columnProfile(t: number): ColumnProfile {
    const length = Math.max(nozzleLip + 0.75, columnTip(t) - oy)
    const samples = 8
    const height = length - nozzleLip
    // Sample close to the nozzle so the column can bend just after leaving it.
    const firstStep = Math.min(22, height / samples)
    const followingStep = (height - firstStep) / (samples - 1)
    const heights = [nozzleY]
    const centres = [ox]
    const widths = [nozzleHalfWidth]
    for (let i = 1; i <= samples; i++) {
      const distance = firstStep + followingStep * (i - 1)
      const y = nozzleY + distance
      const taper = 0.66 + 0.34 * smoothStep(distance / 145)
      const half = (baseWidth / 2) * taper * (0.78 + 0.22 * Math.sin(t * 0.011 + y / 130))
      heights.push(y)
      centres.push(columnCentre(y, t))
      widths.push(nozzleHalfWidth + (half - nozzleHalfWidth) * smoothStep(distance / 48))
    }
    const centreSlopes = smoothTangents(centres, heights)
    const widthSlopes = smoothTangents(widths, heights)
    centreSlopes[0] = centreSlopes[samples] = 0
    widthSlopes[0] = widthSlopes[samples] = 0
    return { heights, centres, widths, centreSlopes, widthSlopes }
  }

  function columnPath({
    heights,
    centres,
    widths,
    centreSlopes,
    widthSlopes,
  }: ColumnProfile): string {
    const samples = heights.length - 1
    const tipY = heights[samples]
    const length = tipY - oy

    function sideCurve(from: number, to: number, side: 1 | -1): string {
      const x0 = centres[from] + side * widths[from]
      const x1 = centres[to] + side * widths[to]
      const y0 = heights[from]
      const y1 = heights[to]
      const third = (y1 - y0) / 3
      return cubicTo(
        x0 + third * (centreSlopes[from] + side * widthSlopes[from]),
        y0 + third,
        x1 - third * (centreSlopes[to] + side * widthSlopes[to]),
        y1 - third,
        x1,
        y1
      )
    }

    // Keep the rounded origin centred under the button as the column bends.
    const topLeft = ox - nozzleHalfWidth
    const topRight = ox + nozzleHalfWidth
    const lipControlY = nozzleY - (4 * nozzleLip) / 3
    let d = `M${f2(topLeft)} ${f2(nozzleY)}`
    d += cubicTo(topLeft, lipControlY, topRight, lipControlY, topRight, nozzleY)
    for (let i = 0; i < samples; i++) d += sideCurve(i, i + 1, 1)

    const tipLeft = centres[samples] - widths[samples]
    const tipRight = centres[samples] + widths[samples]
    const tipControlY = tipY + Math.min(widths[samples] * COLUMN_TIP_CAP_RATIO, length * 0.55)
    d += cubicTo(tipRight, tipControlY, tipLeft, tipControlY, tipLeft, tipY)
    for (let i = samples; i > 0; i--) d += sideCurve(i, i - 1, -1)
    return d + "Z"
  }

  function columnXAt({ heights, centres, centreSlopes }: ColumnProfile, y: number): number {
    const last = heights.length - 1
    const i = heights.findIndex((height) => height > y)
    if (i <= 0) return centres[i === 0 ? 0 : last]
    const distance = heights[i] - heights[i - 1]
    const third = distance / 3
    return cubicValue(
      centres[i - 1],
      centres[i - 1] + third * centreSlopes[i - 1],
      centres[i] - third * centreSlopes[i],
      centres[i],
      (y - heights[i - 1]) / distance
    )
  }

  function contactPoint(surface: WaterSurface, column: ColumnProfile): LiquidOrigin | null {
    // Both curves are shallow near the impact. Re-evaluate each against the other
    // to align with the drawn paths, including the shift used near the top edge.
    let x = ox
    let y = surfaceAt(surface, x)
    for (let i = 0; i < 5; i++) {
      x = columnXAt(column, y)
      y = surfaceAt(surface, x)
    }
    if (y <= nozzleY || y > column.heights[column.heights.length - 1]) return null
    return { x, y }
  }

  const splashParticles: SplashParticle[] = []

  function addSplashParticle(
    spawnAt: number,
    side: number,
    angle: number,
    speed: number,
    radius: number
  ): void {
    const strength = splashDecay(H - waterDepth(spawnAt), H, nozzleY)
    if (strength === 0) return
    const contact = contactPoint(waterSurface(spawnAt, strength), columnProfile(spawnAt))
    if (!contact) return

    const { x, y } = contact
    const remaining = Math.sqrt(strength)
    const room = side < 0 ? x : W - x
    const spread = Math.max(0.25, clamp01(room / 108))
    // Inherit the rising liquid's speed so the arc clears the surface. The
    // launch speed relative to the liquid sets its height and flight time.
    const vx = side * Math.cos(angle) * speed * spread
    const launchSpeed = Math.min(maxSplashSpeed, Math.sin(angle) * speed) * remaining
    const riseSpeed = (waterDepth(spawnAt + 1) - waterDepth(spawnAt - 1)) / 2
    const vy0 = -riseSpeed - launchSpeed
    const flightTime = (2 * launchSpeed) / SPLASH_GRAVITY
    let landAt = spawnAt + flightTime + 64
    for (let age = flightTime / 2; spawnAt + age < Math.min(landAt, total); age += 8) {
      const time = spawnAt + age
      const dropY = y + vy0 * age + 0.5 * SPLASH_GRAVITY * age * age
      if (dropY >= surfaceAt(waterSurface(time), x + vx * age)) {
        landAt = time
        break
      }
    }
    splashParticles.push({ spawnAt, landAt, x, y, vx, vy0, radius: radius * remaining })
  }

  // At first impact, a staggered fan of larger drops is followed by fine spray.
  for (let i = 0; i < 16; i++) {
    const fine = i >= 10
    const lane = fine ? i - 10 : i
    const side = lane % 2 === 0 ? -1 : 1
    const step = Math.floor(lane / 2)
    const delay = (fine ? 22 + step * 14 : step * 5) + (lane % 2) * 4
    const angle = ((fine ? 21 + step * 8 : 33 + step * 11) * Math.PI) / 180
    const speed = (fine ? 0.82 : 0.61) + ((i * 7 + 3) % 5) * 0.062
    addSplashParticle(impact + delay, side, angle, speed, (fine ? 1.5 : 2.7) + (i % 3) * 0.5)
  }

  // Thin new emissions as the surface rises. Drops already in flight keep their arcs.
  const emissionStep = 8
  let accumulated = 0
  let emitted = 0
  for (let t = impact + 48; t < riseStart + timeline.rise; t += emissionStep) {
    const strength = splashDecay(H - waterDepth(t), H, nozzleY)
    if (strength === 0) break
    accumulated += (emissionStep / 44) * Math.sqrt(strength)
    if (accumulated < 1) continue

    accumulated -= 1
    const i = emitted++
    const side = i % 2 === 0 ? -1 : 1
    const angle = ((26 + hash01(i * 9.29 + 4) * 40) * Math.PI) / 180
    const speed = 0.55 + hash01(i * 11.37 + 5) * 0.75
    const radius = 2.4 + hash01(i * 13.91 + 6) * 2.2
    addSplashParticle(t, side, angle, speed, radius)
  }

  function frame(elapsed: number): LiquidFrame {
    const t = Math.max(0, elapsed)
    const water = t >= impact ? waterSurface(t) : null
    if (water?.covered || t >= total) {
      return {
        d: filledPath,
        bottom: H,
        phaseIndex: LIQUID_PHASES.length - 1,
        done: t >= total,
        water: true,
        covered: true,
      }
    }

    const column = columnProfile(t)
    const parts = water ? [waterPath(water), columnPath(column)] : [columnPath(column)]
    const tip = column.heights.length - 1
    // Include the end cap's control points and the full radius of any drops.
    let bottom = water ? H : column.heights[tip] + column.widths[tip] * COLUMN_TIP_CAP_RATIO

    for (const droplet of droplets) {
      const pos = dropletPosition(droplet, t)
      if (!pos || pos.y > H + 20) continue
      bottom = Math.max(bottom, pos.y + droplet.radius)
      parts.push(circle(pos.x, pos.y, droplet.radius * smoothStep((t - droplet.spawnAt) / 36)))
    }

    for (const particle of splashParticles) {
      const age = t - particle.spawnAt
      if (age < 0 || t >= particle.landAt) continue
      const x = particle.x + particle.vx * age
      const y = particle.y + particle.vy0 * age + 0.5 * SPLASH_GRAVITY * age * age
      if (y > H + 8 || x < -particle.radius || x > W + particle.radius) continue
      const fadeTime = Math.min(36, (particle.landAt - particle.spawnAt) / 3)
      const envelope = smoothStep(age / fadeTime) * smoothStep((particle.landAt - t) / fadeTime)
      parts.push(circle(x, y, particle.radius * envelope))
    }

    const phaseIndex = t < impact ? 0 : t < riseStart ? 1 : 2

    return {
      d: parts.join(""),
      bottom: Math.min(H, bottom + 1),
      phaseIndex,
      done: false,
      water: water !== null,
      covered: false,
    }
  }

  return { frame, impactAt: impact, total }
}
