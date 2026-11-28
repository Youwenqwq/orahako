import type { LiquidAppearance } from "./liquid-core"

const SURFACE_ATTR = "data-liquid-reveal-snapshot"
const MASK_ID = "ysu-liquid-reveal-snapshot-mask"
const SVG_NS = "http://www.w3.org/2000/svg"

export interface LiquidSurface {
  mount(ready: () => void, unavailable: () => void): void
  draw(path: string, bottom?: number): void
  revealNavigation?(source: LiquidAppearance, path: string): void
  keepTarget?(): void
  dispose(): void
}

export function createLiquidMask(id: string, width: number, height: number) {
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("width", "0")
  svg.setAttribute("height", "0")
  svg.setAttribute("aria-hidden", "true")
  svg.style.position = "absolute"

  const mask = document.createElementNS(SVG_NS, "mask")
  mask.setAttribute("id", id)
  mask.setAttribute("maskUnits", "objectBoundingBox")
  mask.setAttribute("maskContentUnits", "objectBoundingBox")
  mask.setAttribute("mask-type", "luminance")
  mask.setAttribute("x", "0")
  mask.setAttribute("y", "0")
  mask.setAttribute("width", "1")
  mask.setAttribute("height", "1")

  const background = document.createElementNS(SVG_NS, "rect")
  background.setAttribute("width", "1")
  background.setAttribute("height", "1")
  background.setAttribute("fill", "white")
  const liquid = document.createElementNS(SVG_NS, "path")
  liquid.setAttribute("transform", `scale(${1 / width} ${1 / height})`)
  liquid.setAttribute("fill", "black")
  mask.append(background, liquid)
  svg.appendChild(mask)

  return {
    svg,
    image: `url("#${id}")`,
    draw(path: string) {
      if (liquid.getAttribute("d") !== path) liquid.setAttribute("d", path)
    },
  }
}

export function previewLiquidAppearance(target: LiquidAppearance, onAppearanceChange: () => void) {
  const root = document.documentElement
  const dark = root.classList.contains("dark")
  const light = root.classList.contains("light")
  const scheme = root.style.colorScheme
  root.classList.toggle("dark", target === "dark")
  root.classList.toggle("light", target === "light")
  root.style.colorScheme = target
  onAppearanceChange()

  return () => {
    // Preserve an appearance already applied by a system or cross-tab update.
    if (
      root.classList.contains(target) &&
      !root.classList.contains(target === "dark" ? "light" : "dark") &&
      root.style.colorScheme === target
    ) {
      root.classList.toggle("dark", dark)
      root.classList.toggle("light", light)
      root.style.colorScheme = scheme
      onAppearanceChange()
    }
  }
}

export function createSnapshotSurface(
  target: LiquidAppearance,
  width: number,
  height: number,
  onAppearanceChange: () => void
): LiquidSurface | null {
  if (typeof document.startViewTransition !== "function") return null
  if (typeof CSS === "undefined" || !CSS.supports("mask-image", `url("#${MASK_ID}")`)) return null

  const root = document.documentElement
  const { svg, image, draw } = createLiquidMask(MASK_ID, width, height)
  svg.setAttribute(SURFACE_ATTR, "")
  const style = document.createElement("style")
  style.setAttribute(SURFACE_ATTR, "")
  style.textContent = `
    html[${SURFACE_ATTR}="revealing"] { view-transition-name: none; }
    html[${SURFACE_ATTR}]::view-transition-old(root) {
      animation: ysu-liquid-snapshot-hold 1s linear infinite;
      mix-blend-mode: normal;
      mask-image: ${image};
    }
    html[${SURFACE_ATTR}]::view-transition { pointer-events: none; }
    html[${SURFACE_ATTR}]::view-transition-group(root) { animation: none; }
    @keyframes ysu-liquid-snapshot-hold { from, to { opacity: 1; } }
    html:root,
    html:root *,
    html:root *::before,
    html:root *::after { transition: none !important; }
  `

  let transition: ViewTransition | undefined
  let restoreAppearance: (() => void) | undefined
  let disposed = false

  function showTarget() {
    if (disposed) return
    // Capture only the old root. The new theme is the live, hit-testable page.
    root.setAttribute(SURFACE_ATTR, "revealing")
    restoreAppearance = previewLiquidAppearance(target, onAppearanceChange)
  }

  return {
    mount(ready, unavailable) {
      try {
        document.body.appendChild(svg)
        document.head.appendChild(style)
        root.setAttribute(SURFACE_ATTR, "capturing")
        transition = document.startViewTransition(showTarget)
        const onUnavailable = () => {
          if (!disposed) unavailable()
        }
        void transition.ready.then(() => {
          if (!disposed) ready()
        }, onUnavailable)
        void transition.finished.then(onUnavailable, onUnavailable)
      } catch {
        unavailable()
      }
    },
    draw,
    keepTarget() {
      restoreAppearance = undefined
    },
    dispose() {
      if (disposed) return
      disposed = true
      const restore = restoreAppearance
      restoreAppearance = undefined
      restore?.()
      transition?.skipTransition()
      root.removeAttribute(SURFACE_ATTR)
      svg.remove()
      if (restore) {
        // Paint the restored palette before allowing CSS transitions again.
        // Removing the guard alongside the theme would tween from the preview.
        requestAnimationFrame(() => requestAnimationFrame(() => style.remove()))
      } else {
        style.remove()
      }
    },
  }
}
