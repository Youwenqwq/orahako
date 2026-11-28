import { afterEach, describe, expect, it, vi } from "vitest"
import type { LiquidAppearance } from "./liquid-core"
import { createSnapshotSurface } from "./liquid-snapshot"

function surfaceHarness(source: LiquidAppearance) {
  const classes = new Set<string>([source])
  const attributes = new Map<string, string>()
  const root = {
    classList: {
      contains: (name: string) => classes.has(name),
      toggle: (name: string, enabled: boolean) =>
        enabled ? classes.add(name) : classes.delete(name),
    },
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    style: { colorScheme: source },
  }

  class MockSvg {
    attributes = new Map<string, string>()
    children: MockSvg[] = []
    style = {}
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value)
    }
    getAttribute(name: string) {
      return this.attributes.get(name)
    }
    append(...children: MockSvg[]) {
      this.children.push(...children)
    }
    appendChild(child: MockSvg) {
      this.append(child)
    }
    remove = vi.fn()
  }

  const style = { textContent: "", setAttribute: vi.fn(), remove: vi.fn() }
  const frames: FrameRequestCallback[] = []
  const appendToBody = vi.fn<(svg: MockSvg) => void>()
  const skipTransition = vi.fn()
  const startViewTransition = vi.fn((_: () => void) => ({
    ready: Promise.resolve(),
    finished: new Promise<void>(() => {}),
    skipTransition,
  }))

  vi.stubGlobal("CSS", { supports: () => true })
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal("document", {
    documentElement: root,
    createElement: () => style,
    createElementNS: () => new MockSvg(),
    head: { appendChild: vi.fn() },
    body: { appendChild: appendToBody },
    startViewTransition,
  })

  const target = source === "dark" ? "light" : "dark"
  const surface = createSnapshotSurface(target, 400, 800, vi.fn())!
  surface.mount(vi.fn(), vi.fn())
  const [update] = startViewTransition.mock.calls[0]
  const [svg] = appendToBody.mock.calls[0]
  return { surface, update, classes, attributes, root, target, skipTransition, svg, style, frames }
}

afterEach(() => vi.unstubAllGlobals())

describe("theme view transition capture", () => {
  it.each(["dark", "light"] as const)("shows %s until the capture callback", (source) => {
    const { surface, update, classes, attributes, root, target } = surfaceHarness(source)
    expect(classes).toEqual(new Set([source]))
    expect(root.style.colorScheme).toBe(source)
    expect(attributes.get("data-liquid-reveal-snapshot")).toBe("capturing")

    update()
    expect(classes).toEqual(new Set([target]))
    expect(root.style.colorScheme).toBe(target)
    expect(attributes.get("data-liquid-reveal-snapshot")).toBe("revealing")

    surface.dispose()
    expect(classes).toEqual(new Set([source]))
    expect(root.style.colorScheme).toBe(source)
  })

  it("cuts the liquid shape out of an otherwise visible old snapshot", () => {
    const { surface, svg } = surfaceHarness("dark")
    const [mask] = svg.children
    const [background, liquid] = mask.children
    const d = "M0 600L400 600L400 800L0 800Z"
    surface.draw(d)

    expect(mask.getAttribute("maskContentUnits")).toBe("objectBoundingBox")
    expect(background.getAttribute("fill")).toBe("white")
    expect(liquid.getAttribute("fill")).toBe("black")
    expect(liquid.getAttribute("transform")).toBe("scale(0.0025 0.00125)")
    expect(liquid.getAttribute("d")).toBe(d)
    surface.dispose()
    expect(svg.remove).toHaveBeenCalledOnce()
  })

  it("keeps the committed target under the reveal when removing the snapshot", () => {
    const { surface, update, classes, attributes, target, style } = surfaceHarness("light")
    update()
    surface.keepTarget?.()
    surface.dispose()

    expect(classes).toEqual(new Set([target]))
    expect(attributes.size).toBe(0)
    expect(style.remove).toHaveBeenCalledOnce()
  })

  it("keeps CSS transitions disabled through the frame that restores the source palette", () => {
    const { surface, update, classes, attributes, style, frames } = surfaceHarness("dark")
    update()
    surface.dispose()

    expect(classes).toEqual(new Set(["dark"]))
    expect(attributes.size).toBe(0)
    expect(style.remove).not.toHaveBeenCalled()

    frames.shift()!(0)
    expect(style.remove).not.toHaveBeenCalled()
    frames.shift()!(16)
    expect(style.remove).toHaveBeenCalledOnce()
  })

  it("ignores a delayed capture callback after cancellation", () => {
    const { surface, update, classes, skipTransition } = surfaceHarness("dark")
    surface.dispose()
    update()

    expect(skipTransition).toHaveBeenCalledOnce()
    expect(classes).toEqual(new Set(["dark"]))
  })
})
