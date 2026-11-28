import { describe, expect, it } from "vitest"
import {
  advanceLiquidElapsed,
  clampOrigin,
  createLiquidSequence,
  LIQUID_PHASES,
  liquidDirection,
  planTimeline,
  shouldCommitOnAbort,
  splashDecay,
  type LiquidGeometry,
} from "./liquid-core"

const GEOMETRY: LiquidGeometry = { width: 800, height: 1200, originX: 200, originY: 120 }

describe("planTimeline", () => {
  it("splits the duration across four positive phases", () => {
    const timeline = planTimeline(1400)
    const sum = timeline.stream + timeline.splash + timeline.rise + timeline.settle
    expect(sum).toBeCloseTo(1400, 6)
    expect(timeline.stream).toBeGreaterThan(0)
    expect(timeline.splash).toBeGreaterThan(0)
    expect(timeline.rise).toBeGreaterThan(0)
    expect(timeline.settle).toBeGreaterThan(0)
  })

  it("clamps extreme durations", () => {
    expect(planTimeline(10).stream + planTimeline(10).splash).toBeGreaterThan(0)
    const tiny = planTimeline(10)
    const huge = planTimeline(99999)
    expect(tiny.stream + tiny.splash + tiny.rise + tiny.settle).toBeLessThanOrEqual(2400)
    expect(huge.stream + huge.splash + huge.rise + huge.settle).toBeLessThanOrEqual(2400)
  })
})

describe("advanceLiquidElapsed", () => {
  it("runs at full speed while the renderer delivers frames normally", () => {
    expect(advanceLiquidElapsed(700, 16)).toBe(716)
    expect(advanceLiquidElapsed(700, 34)).toBe(734)
  })

  it("does not skip to the end when a frame arrives after a long pause", () => {
    const frame = advanceLiquidElapsed(700, 1600)
    expect(frame).toBe(750)
    expect(advanceLiquidElapsed(frame, 16)).toBe(766)
    expect(advanceLiquidElapsed(frame, -3)).toBe(frame)
  })
})

describe("clampOrigin", () => {
  it("falls back to the top-center stream without an origin", () => {
    expect(clampOrigin(null, 800, 1200)).toEqual({ x: 400, y: -12 })
  })

  it("clamps out-of-viewport origins", () => {
    expect(clampOrigin({ x: 9999, y: 9999 }, 800, 1200)).toEqual({ x: 792, y: 1192 })
    expect(clampOrigin({ x: -50, y: -100 }, 800, 1200)).toEqual({ x: 8, y: -40 })
  })
})

describe("splashDecay", () => {
  // Design-note acceptance table: remaining splash = (1-h)² with h the level
  // normalized from first contact (1200) up to the nozzle (120).
  const decayAt = (fraction: number) => splashDecay(1200 - 1080 * fraction, 1200, 120)

  it("follows the quadratic S = S_max·(1-h)² curve", () => {
    expect(decayAt(0)).toBeCloseTo(1) // 0% — full splash
    expect(decayAt(0.1)).toBeCloseTo(0.81)
    expect(decayAt(0.5)).toBeCloseTo(0.25) // mid-climb — 25%
    expect(decayAt(0.9)).toBeCloseTo(0.01) // 90% — 1%
    expect(decayAt(1)).toBeCloseTo(0) // nozzle — silent
  })

  it("decays monotonically with a zero end slope", () => {
    const samples = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map(decayAt)
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThan(samples[i - 1])
    }
    // Flattens near the nozzle: the last step is far smaller than the first.
    expect(samples[9] - samples[10]).toBeLessThan((samples[0] - samples[1]) / 8)
  })

  it("clamps levels beyond the span and rejects degenerate ranges", () => {
    expect(splashDecay(2000, 1200, 120)).toBe(1) // below first contact — full
    expect(splashDecay(-500, 1200, 120)).toBe(0) // above the nozzle — silent
    expect(splashDecay(600, 1200, 1200)).toBe(0) // no span
    expect(splashDecay(600, 1200, 1500)).toBe(0) // inverted span
    expect(splashDecay(NaN, 1200, 120)).toBe(0)
    expect(splashDecay(600, NaN, 120)).toBe(0)
  })
})

describe("liquidDirection", () => {
  it("maps appearances to audio directions", () => {
    expect(liquidDirection("dark")).toBe("to-dark")
    expect(liquidDirection("light")).toBe("to-light")
  })
})

describe("createLiquidSequence", () => {
  const timeline = planTimeline(1400)
  const sequence = createLiquidSequence(GEOMETRY, timeline)

  function sample(step = 16) {
    const frames = []
    for (let t = 0; t <= sequence.total + step; t += step) frames.push(sequence.frame(t))
    return frames
  }

  it("starts with a column only — no water, no droplets, no splash", () => {
    const frame = sequence.frame(0)
    expect(frame.phaseIndex).toBe(0)
    expect(frame.water).toBe(false)
    expect(frame.done).toBe(false)
    expect(frame.d).toContain("M")
    expect(frame.d).not.toContain("a") // no arc commands (circles) yet
  })

  it("rounds both ends and the sides of the falling column", () => {
    const frame = sequence.frame(timeline.stream * 0.5)
    expect(frame.water).toBe(false)
    const column = frame.d.split("Z")[0]
    expect(column.match(/C/g)).toHaveLength(18)
    expect(column).not.toMatch(/[LQ]/)
  })

  it("keeps the outlet anchored while the sides bend just below it", () => {
    const columns = [0.44, 0.58, 0.72, 0.92].map(
      (fraction) => sequence.frame(timeline.stream * fraction).d.split("Z")[0]
    )
    const parts = columns.map((path) => path.split("C"))
    const caps = parts.map(([start, cap]) => start + cap)

    expect(new Set(caps).size).toBe(1)
    const [start, cap] = parts[0]
    const [left, capStartY] = start.slice(1).split(" ").map(Number)
    const [, capControlY, , , right] = cap.split(" ").map(Number)
    expect((left + right) / 2).toBeCloseTo(GEOMETRY.originX, 2)
    expect(0.25 * capStartY + 0.75 * capControlY).toBeCloseTo(GEOMETRY.originY, 2)

    const upperCentres = parts.map((segments) => {
      const [, , , , upperRight, y] = segments[2].split(" ").map(Number)
      const upperLeft = Number(segments.at(-2)!.split(" ")[4])
      expect(y - capStartY).toBeLessThanOrEqual(22.01)
      return (upperLeft + upperRight) / 2
    })
    expect(Math.max(...upperCentres) - Math.min(...upperCentres)).toBeGreaterThan(2)
  })

  it("detaches droplets during the stream (arc subpaths present)", () => {
    const frame = sequence.frame(timeline.stream * 0.6)
    expect(frame.d).toContain("a")
  })

  it("bounds the visible column and detached drops before the water reaches the bottom", () => {
    expect(sequence.frame(0).bottom).toBeLessThan(GEOMETRY.height)
    for (const frame of sample(5).filter(({ water }) => !water)) {
      const [column] = frame.d.split("Z")
      const controls = [...column.matchAll(/C([^C]+)/g)].flatMap(([, points]) =>
        points.split(" ").filter((_, index) => index % 2 === 1).map(Number)
      )
      const drops = [...frame.d.matchAll(/M-?[\d.]+ (-?[\d.]+)a([\d.]+)/g)].map(
        ([, y, radius]) => Number(y) + Number(radius)
      )
      const visibleBottom = Math.min(GEOMETRY.height, Math.max(...controls, ...drops))
      expect(frame.bottom).toBeGreaterThanOrEqual(visibleBottom)
    }
    expect(sequence.frame(sequence.impactAt).bottom).toBe(GEOMETRY.height)
  })

  it("shows water from the impact moment on", () => {
    const frame = sequence.frame(sequence.impactAt + 1)
    expect(frame.water).toBe(true)
    expect(frame.phaseIndex).toBe(1)
    // Splash particles grow into visible droplets shortly after impact.
    expect(sequence.frame(sequence.impactAt + 25).d).toContain("a")
  })

  it("fans out visible splash drops on both sides of a mobile impact near the edge", () => {
    const geometry = { width: 411, height: 925, originX: 379, originY: 68 }
    const reveal = createLiquidSequence(geometry, timeline)
    const splash = reveal.frame(reveal.impactAt + 115).d
    const centres = [...splash.matchAll(/M(-?[\d.]+) (-?[\d.]+)a([\d.]+)/g)]
      .map(([, x, y, radius]) => ({ x: Number(x) + Number(radius), y: Number(y) }))
      .filter(
        ({ x, y }) =>
          x > 0 && x < geometry.width && y > geometry.height - 100 && y < geometry.height
      )

    expect(centres.length).toBeGreaterThanOrEqual(10)
    expect(Math.min(...centres.map(({ x }) => x))).toBeLessThan(geometry.originX - 34)
    expect(Math.max(...centres.map(({ x }) => x))).toBeGreaterThan(geometry.originX + 9)
  })

  it("fades the contact spray as the water climbs toward the nozzle", () => {
    const riseStart = timeline.stream + timeline.splash
    const countAt = (t: number) => [...sequence.frame(t).d.matchAll(/M-?[\d.]+ -?[\d.]+a/g)].length

    // Early climb — the contact area still erupts continuously.
    const early = [40, 120, 200, 280].map((dt) => countAt(riseStart + dt))
    expect(Math.min(...early)).toBeGreaterThanOrEqual(2)

    // Mid climb — thinner but still seen erupting inside the window.
    const midAt = riseStart + Math.floor(timeline.rise * 0.45)
    const mid = [0, 80, 160, 240].map((dt) => countAt(midAt + dt))
    expect(mid.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(2)

    // Late climb — drops shrink and thin out; near the nozzle almost none.
    const lateAt = riseStart + Math.floor(timeline.rise * 0.82)
    const late = [0, 60, 120].map((dt) => countAt(lateAt + dt))
    expect(Math.max(...late)).toBeLessThanOrEqual(1)

    // The fade is gradual overall, not a switch-off.
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
    expect(sum(late)).toBeLessThan(sum(early))
  })

  it("advances phases strictly in order and finishes fully covering the viewport", () => {
    const frames = sample()
    let previous = -1
    for (const frame of frames) {
      expect(frame.phaseIndex).toBeGreaterThanOrEqual(previous)
      expect(frame.phaseIndex).toBeLessThan(LIQUID_PHASES.length)
      previous = frame.phaseIndex
    }
    const last = frames[frames.length - 1]
    expect(last.done).toBe(true)
    expect(last.water).toBe(true)
    // Full-viewport cover at the end.
    expect(last.d).toBe(`M0 0L800 0L800 1200L0 1200Z`)
  })

  it("emits each phase exactly once when the caller tracks index changes", () => {
    const seen: string[] = []
    let last = -1
    for (let t = 0; t <= sequence.total; t += 16) {
      const { phaseIndex } = sequence.frame(t)
      if (phaseIndex > last) {
        seen.push(LIQUID_PHASES[phaseIndex])
        last = phaseIndex
      }
    }
    expect(seen).toEqual(["stream", "splash", "rise", "settle"])
  })

  function waveCurves(path: string): number[][] {
    const water = path.split("Z")[0]
    return [...water.matchAll(/C([\d .-]+)/g)].map((match) => match[1].split(" ").map(Number))
  }

  /** Water body is the first Z-terminated subpath; collect its top boundary. */
  function topBoundaryYs(frame: { d: string }): number[] {
    const leftHeight = Number(frame.d.match(/L0 (-?[\d.]+)/)?.[1])
    return [leftHeight, ...waveCurves(frame.d).map((curve) => curve[5])]
  }

  it("keeps the splash as visible round droplets whose flight gets lower during the rise", () => {
    const { width, height, originX, originY } = GEOMETRY
    const timeline = planTimeline(2400)
    const reveal = createLiquidSequence(GEOMETRY, timeline)
    const nozzleY = originY + width * 0.018 * 0.14
    const riseStart = timeline.stream + timeline.splash
    const timeAt = (h: number) =>
      riseStart + (timeline.rise * ((height - nozzleY) * h - 10)) / (height + 2 - 10)
    const maxFlightHeight = (from: number, to: number) => {
      let maxHeight = 0
      for (let t = timeAt(from); t <= timeAt(to); t += 8) {
        const frame = reveal.frame(t)
        const wave = waveCurves(frame.d)
        const leftY = topBoundaryYs(frame)[0]
        for (const path of frame.d.split("Z").slice(2).filter(Boolean)) {
          const [, left, centerY, r] = path.match(/^M(-?[\d.]+) (-?[\d.]+)a([\d.]+)/) ?? []
          expect(r).toBeDefined()
          const radius = Number(r)
          const x = Number(left) + radius
          if (x < 0 || x > width || Math.abs(x - originX) < 8) continue
          const i = wave.findIndex((curve) => curve[4] >= x)
          const [prevX, prevY] = i ? wave[i - 1].slice(4) : [0, leftY]
          const [, b, , c, nextX, d] = wave[i]
          const u = (x - prevX) / (nextX - prevX)
          const v = 1 - u
          const waveY = prevY * v ** 3 + 3 * b * v * v * u + 3 * c * v * u * u + d * u ** 3
          const flightHeight = waveY - Number(centerY)
          if (flightHeight > radius) maxHeight = Math.max(maxHeight, flightHeight)
        }
      }
      return maxHeight
    }

    const early = maxFlightHeight(0.1, 0.2)
    const middle = maxFlightHeight(0.47, 0.57)
    expect(early).toBeGreaterThan(40)
    expect(middle).toBeGreaterThan(5)
    expect(middle).toBeLessThan(early * 0.6)
    expect(maxFlightHeight(0.9, 1)).toBeLessThan(5)
  })

  it("raises the water at a constant rate while the surface ripples", () => {
    const riseStart = timeline.stream + timeline.splash
    const heights = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9].map((progress) => {
      const points = topBoundaryYs(sequence.frame(riseStart + timeline.rise * progress))
      return points.reduce((sum, height) => sum + height, 0) / points.length
    })
    const distances = heights.slice(1).map((height, i) => heights[i] - height)
    const expected = (heights[0] - heights.at(-1)!) / distances.length

    expect(expected).toBeGreaterThan(0)
    for (const distance of distances) {
      expect(Math.abs(distance - expected)).toBeLessThan(expected * 0.04)
    }
  })

  it("keeps the smoothed wave within the sampled troughs", () => {
    const frame = sequence.frame(timeline.stream + timeline.splash + timeline.rise * 0.9)
    const boundary = topBoundaryYs(frame)
    const curves = waveCurves(frame.d)
    expect(curves.length).toBeGreaterThan(1)
    for (let i = 0; i < curves.length; i++) {
      const [, firstControlY, , secondControlY] = curves[i]
      const high = Math.max(boundary[i], boundary[i + 1])
      const low = Math.min(boundary[i], boundary[i + 1])
      expect(Math.min(firstControlY, secondControlY)).toBeGreaterThanOrEqual(low)
      expect(Math.max(firstControlY, secondControlY)).toBeLessThanOrEqual(high)
    }
  })

  it.each([
    { width: 390, height: 844, originX: 355, originY: 160 },
    { width: 1366, height: 768, originX: 950, originY: 700 },
    { width: 2560, height: 1440, originX: 1280, originY: 48 },
  ])(
    "keeps pouring and moving the wave until the $width × $height viewport is full",
    (geometry) => {
      const reveal = createLiquidSequence(geometry, timeline)
      const riseEnd = reveal.total - timeline.settle
      let nearTop: number[] | undefined
      let lastPartial = reveal.frame(riseEnd - 70)
      let t = riseEnd - 69

      for (; t <= riseEnd; t++) {
        const frame = reveal.frame(t)
        if (frame.covered) break

        const boundary = topBoundaryYs(frame)
        const gap = Math.max(...boundary)
        if (gap > 2 && gap < 12) nearTop = boundary
        lastPartial = frame
      }

      expect(nearTop).toBeDefined()
      expect(Math.max(...nearTop!) - Math.min(...nearTop!)).toBeGreaterThan(4)
      expect(lastPartial.phaseIndex).toBe(2)
      expect(lastPartial.d.split("Z")[1]).toMatch(/^M[^C]+C/)

      const firstFull = reveal.frame(t)
      expect(firstFull.covered).toBe(true)
      expect(firstFull.phaseIndex).toBe(3)
      expect(firstFull.done).toBe(false)
      const { width, height } = geometry
      expect(firstFull.d).toBe(`M0 0L${width} 0L${width} ${height}L0 ${height}Z`)
      expect(reveal.frame(reveal.total).done).toBe(true)
    }
  )

  it("stays deterministic for the same inputs", () => {
    const a = createLiquidSequence(GEOMETRY, timeline)
    const b = createLiquidSequence(GEOMETRY, timeline)
    for (const t of [0, 100, sequence.impactAt, sequence.impactAt + 50, sequence.total - 10]) {
      expect(a.frame(t).d).toBe(b.frame(t).d)
    }
  })

  it("clamps tiny viewports without producing NaN path data", () => {
    const tiny = createLiquidSequence({ width: 2, height: 2, originX: 1, originY: 1 }, timeline)
    for (let t = 0; t <= tiny.total; t += 32) {
      expect(tiny.frame(t).d).not.toContain("NaN")
    }
  })
})

describe("shouldCommitOnAbort", () => {
  it("commits the accepted target for local interruptions", () => {
    for (const reason of ["geometry", "hidden", "timeout", "unmount", "manual"] as const) {
      expect(shouldCommitOnAbort(reason)).toBe(true)
    }
  })

  it("keeps the newest external theme and superseding requests", () => {
    expect(shouldCommitOnAbort("external-theme")).toBe(false)
    expect(shouldCommitOnAbort("superseded")).toBe(false)
  })
})
