/**
 * Reveal the live target theme through an old-page snapshot. A clipped theme
 * copy preserves the reveal when the engine lacks snapshots or the page moves.
 */

import {
  advanceLiquidElapsed,
  clampOrigin,
  createLiquidSequence,
  DEFAULT_LIQUID_DURATION,
  LIQUID_PHASES,
  liquidDirection,
  planTimeline,
  shouldCommitOnAbort,
  type LiquidAbortReason,
  type LiquidAppearance,
  type LiquidDirection,
  type LiquidOrigin,
  type LiquidPhase,
} from "./liquid-core"
import {
  createLiquidMask,
  createSnapshotSurface,
  previewLiquidAppearance,
  type LiquidSurface,
} from "./liquid-snapshot"

const OVERLAY_Z = "2147483000"
const CLIP_ID = "ysu-liquid-reveal-clip"
const NAVIGATION_MASK_ID = "ysu-liquid-navigation-mask"
const SVG_NS = "http://www.w3.org/2000/svg"
const STALLED_FRAME_TIMEOUT_MS = 1500
const LAYOUT_LOOKAHEAD_PX = 64

/** Theme variables declared in app/globals.css `:root` and `.dark`. */
const THEME_VARIABLES = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--radius",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
  "--schedule-1",
  "--schedule-2",
  "--schedule-3",
  "--schedule-4",
  "--schedule-5",
  "--schedule-6",
  "--schedule-7",
  "--schedule-8",
]

export interface StartLiquidRevealOptions {
  /** Appearance the liquid must reveal (the real theme commit value). */
  targetAppearance: LiquidAppearance
  /** Start point, usually the triggering control's bottom-edge center. */
  origin: LiquidOrigin | null
  duration?: number
  onBegin?: (direction: LiquidDirection) => void
  onPhase?: (phase: LiquidPhase) => void
  /** Visual finished — commit the real theme now. */
  onCommit?: () => void
  onAbort?: (reason: LiquidAbortReason, commit: boolean) => void
}

export interface LiquidRevealHandle {
  cancel: (reason: LiquidAbortReason, commit?: boolean) => void
  revealNavigation: () => void
}

let activeHandle: LiquidRevealHandle | null = null

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  )
}

export function isLiquidRevealSupported(): boolean {
  if (typeof window === "undefined") return false
  const hasSvg =
    typeof SVGElement !== "undefined" &&
    typeof (window as unknown as { SVGClipPathElement?: unknown }).SVGClipPathElement !==
      "undefined"
  const supportsClip =
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("clip-path", "url(#ysu-liquid-probe)")
  return hasSvg && supportsClip
}

type ThemeVariables = Record<LiquidAppearance, Record<string, string>>

const preparedThemeVariables = new WeakMap<CSSStyleSheet, ThemeVariables>()

function collectThemeVariables(rules: CSSRuleList, variables: ThemeVariables): void {
  for (const rule of Array.from(rules)) {
    const { selectorText, style } = rule as CSSStyleRule
    const values =
      selectorText === ".dark"
        ? variables.dark
        : selectorText === ":root" || selectorText === "html" || selectorText === ":root, :host"
          ? variables.light
          : undefined
    if (style && values) {
      for (const name of THEME_VARIABLES) {
        const value = style.getPropertyValue(name)
        if (value) values[name] = value.trim()
      }
    }
    // Theme declarations may be inside bundler-emitted layers or groups.
    const nested = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules
    if (nested?.length) collectThemeVariables(nested, variables)
  }
}

/** Read the declarations of both palettes independently of the live html class. */
function readThemeVariables(appearance: LiquidAppearance): Record<string, string> {
  const variables: ThemeVariables = { light: {}, dark: {} }
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const prepared = preparedThemeVariables.get(sheet)
      if (prepared) {
        Object.assign(variables.light, prepared.light)
        Object.assign(variables.dark, prepared.dark)
      } else {
        collectThemeVariables(sheet.cssRules, variables)
      }
    } catch {
      // Cross-origin sheet — skipped, same as the shadow copy.
    }
  }

  // The host inherits runtime variables such as safe-area insets from html.
  return appearance === "dark" ? { ...variables.light, ...variables.dark } : variables.light
}

function documentStylesheets(): (HTMLStyleElement | HTMLLinkElement)[] {
  return Array.from(
    document.head.querySelectorAll<HTMLStyleElement | HTMLLinkElement>(
      'style:not([data-liquid-reveal-snapshot]), link[rel="stylesheet"]'
    )
  )
}

const inlineStylesheets = new WeakMap<CSSStyleSheet, string | null>()
const preparedStylesheets = new WeakMap<CSSStyleSheet, CSSStyleSheet>()
const externalCssReferences = /@import\b|\b(?:url|src|(?:-webkit-)?image-set)\(/i

function getPreparedStylesheet(node: HTMLStyleElement | HTMLLinkElement): CSSStyleSheet | undefined {
  const source = node.sheet
  if (!source || source.disabled) return
  const prepared = preparedStylesheets.get(source)
  if (prepared?.media.mediaText === source.media.mediaText) return prepared
}

export function prepareLiquidOverlayStyles(): (() => void) | undefined {
  if (
    prefersReducedMotion() ||
    typeof window.requestIdleCallback !== "function" ||
    typeof ShadowRoot === "undefined" ||
    !("adoptedStyleSheets" in ShadowRoot.prototype)
  ) {
    return
  }

  let idle = 0
  schedule(() => prepare(documentStylesheets()))
  return () => window.cancelIdleCallback(idle)

  function schedule(work: () => void) {
    idle = window.requestIdleCallback(() => {
      if (!activeHandle) work()
    })
  }

  function prepare(sheets: ReturnType<typeof documentStylesheets>) {
    // Only a trailing run can be adopted without changing cascade order.
    let node = sheets.pop()
    while (node && getPreparedStylesheet(node)) node = sheets.pop()
    if (!node || !node.sheet || node.sheet.disabled) return

    const source = node.sheet
    const media = node.media
    const isLinked = node instanceof HTMLLinkElement
    const text = isLinked ? getInlineStylesheetText(source) : node.textContent
    if (text == null || externalCssReferences.test(text)) return

    schedule(() => {
      try {
        const stylesheet = new CSSStyleSheet({ media })
        stylesheet.replaceSync(text)
        preparedStylesheets.set(source, stylesheet)
      } catch {
        // The inline copy remains available when constructed stylesheets fail.
        return
      }
      schedule(() => {
        if (isLinked) {
          // Cache only stable, built CSS. Inline and runtime rules stay live.
          const palette: ThemeVariables = { light: {}, dark: {} }
          collectThemeVariables(source.cssRules, palette)
          preparedThemeVariables.set(source, palette)
        }
        prepare(sheets)
      })
    })
  }
}

function copyDocumentStylesheets(target: HTMLElement, shadow: ShadowRoot): void {
  const sheets = documentStylesheets()
  const adopted: CSSStyleSheet[] = []
  for (let index = sheets.length - 1; index >= 0; index--) {
    const stylesheet = getPreparedStylesheet(sheets[index])
    if (!stylesheet) break
    adopted.unshift(stylesheet)
  }
  if (adopted.length) {
    try {
      shadow.adoptedStyleSheets = adopted
      sheets.length -= adopted.length
    } catch {
      // Keep the same cascade through normal stylesheet elements.
    }
  }
  for (const sheet of sheets) {
    if (sheet instanceof HTMLLinkElement) {
      const text = getInlineStylesheetText(sheet.sheet)
      if (text !== undefined) {
        const style = document.createElement("style")
        style.media = sheet.media
        style.textContent = text
        target.appendChild(style)
        continue
      }
    }
    target.appendChild(sheet.cloneNode(true))
  }
}

/** Inline the built rules that are independent of their resource URL. */
function getInlineStylesheetText(sheet: CSSStyleSheet | null): string | undefined {
  if (!sheet?.href || sheet.disabled || !new URL(sheet.href).pathname.includes("/_next/static/")) {
    return undefined
  }
  const cached = inlineStylesheets.get(sheet)
  if (cached !== undefined) return cached ?? undefined

  try {
    const text = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n")
    // Preserve the original link for rules that can resolve relative resources.
    if (!externalCssReferences.test(text)) {
      inlineStylesheets.set(sheet, text)
      return text
    }
  } catch {
    // The CSSOM is unavailable for cross-origin stylesheets.
  }
  inlineStylesheets.set(sheet, null)
  return undefined
}

/** Skip elements that belong to the scripts or the old-page capture. */
function isCopyable(node: Node): boolean {
  return (
    !(node instanceof HTMLScriptElement) &&
    !(node instanceof Element && node.hasAttribute("data-liquid-reveal-snapshot"))
  )
}

function cloneBodyChildren(stage: HTMLElement): void {
  for (const child of Array.from(document.body.childNodes)) {
    if (!isCopyable(child)) continue
    stage.appendChild(child.cloneNode(true))
  }
}

/** Parallel walk over source and snapshot trees (structure is identical). */
function syncInteractiveState(
  sourceRoot: Element,
  cloneRoot: Element,
  clones: WeakMap<Element, Element>
): { clone: Element; top: number; left: number }[] {
  const scrollOffsets: { clone: Element; top: number; left: number }[] = []
  function visit(source: Element, clone: Element): void {
    clones.set(source, clone)
    const tag = source.tagName
    if (tag === "INPUT") {
      const src = source as HTMLInputElement
      const dst = clone as HTMLInputElement
      dst.value = src.value
      dst.checked = src.checked
    } else if (tag === "TEXTAREA") {
      ;(clone as HTMLTextAreaElement).value = (source as HTMLTextAreaElement).value
    } else if (tag === "SELECT") {
      ;(clone as HTMLSelectElement).selectedIndex = (source as HTMLSelectElement).selectedIndex
    } else if (source instanceof HTMLCanvasElement && clone instanceof HTMLCanvasElement) {
      try {
        clone.getContext("2d")?.drawImage(source, 0, 0)
      } catch {
        // WebGL or tainted canvas — snapshot stays blank, acceptable.
      }
    }
    if (source instanceof HTMLElement) {
      const { scrollTop: top, scrollLeft: left } = source
      if (top || left) scrollOffsets.push({ clone, top, left })
      if (
        source.hasAttribute("data-liquid-route-content") &&
        clone instanceof HTMLElement &&
        clone.classList.contains("animate-in") &&
        typeof source.getAnimations === "function"
      ) {
        // A newly mounted copy would otherwise replay the route's entrance.
        const entrance = source.getAnimations().find(
          (animation) => "animationName" in animation && animation.animationName === "enter"
        )
        const elapsed = entrance?.currentTime
        if (typeof elapsed === "number") clone.style.animationDelay = `-${Math.max(0, elapsed)}ms`
        else clone.classList.remove("animate-in")
      }
    }
    const srcKids = Array.from(source.children).filter(isCopyable)
    const dstKids = Array.from(clone.children).filter(isCopyable)
    const len = Math.min(srcKids.length, dstKids.length)
    for (let i = 0; i < len; i++) visit(srcKids[i], dstKids[i])
  }
  visit(sourceRoot, cloneRoot)
  return scrollOffsets
}

function createDomSurface(
  target: LiquidAppearance,
  width: number,
  height: number,
  isSourcePage: () => boolean,
  beforeAttach?: () => void
): LiquidSurface {
  const host = document.createElement("div")
  host.setAttribute("data-liquid-reveal-overlay", "")
  host.setAttribute("aria-hidden", "true")
  try {
    host.inert = true
  } catch {
    // inert unsupported — closed shadow + pointer-events still isolate input
  }
  host.style.cssText = `position:fixed;inset:0;z-index:${OVERLAY_Z};pointer-events:none;`

  const shadow = host.attachShadow({ mode: "closed" })

  // Stylesheet copies let utility classes resolve inside the shadow tree.
  const sheetHost = document.createElement("div")
  sheetHost.style.cssText = "display:none"
  copyDocumentStylesheets(sheetHost, shadow)
  shadow.appendChild(sheetHost)

  // The clipped wrapper applies the target theme above the live source page.
  const freeze = document.createElement("div")
  freeze.style.cssText =
    "position:absolute;inset:0;overflow:hidden;contain:layout;" +
    "background:var(--background);color:var(--foreground);"
  function applyAppearance(appearance: LiquidAppearance) {
    freeze.classList.toggle("dark", appearance === "dark")
    freeze.style.colorScheme = appearance
    const variables = readThemeVariables(appearance)
    for (const [name, value] of Object.entries(variables)) {
      freeze.style.setProperty(name, value)
    }
  }
  applyAppearance(target)

  // Scale the clip with the viewport while the copy lays out at its actual size.
  const svg = document.createElementNS(SVG_NS, "svg")
  svg.setAttribute("width", "0")
  svg.setAttribute("height", "0")
  svg.setAttribute("aria-hidden", "true")
  svg.style.position = "absolute"
  const clipPath = document.createElementNS(SVG_NS, "clipPath")
  clipPath.setAttribute("id", CLIP_ID)
  clipPath.setAttribute("clipPathUnits", "objectBoundingBox")
  const path = document.createElementNS(SVG_NS, "path")
  path.setAttribute("transform", `scale(${1 / width} ${1 / height})`)
  path.setAttribute("d", "M0 0Z")
  clipPath.appendChild(path)
  svg.appendChild(clipPath)
  shadow.appendChild(svg)
  freeze.style.clipPath = `url('#${CLIP_ID}')`

  const stage = document.createElement("div")
  stage.style.position = "relative"
  cloneBodyChildren(stage)
  freeze.appendChild(stage)

  shadow.appendChild(freeze)

  const clones = new WeakMap<Element, Element>()
  const deferredLayout: { element: HTMLElement; top: number; bottom: number }[] = []
  let navigationMask: ReturnType<typeof createLiquidMask> | undefined
  let liquidBottom = 0
  let pageX = 0
  let pageY = 0

  function prepareDeferredLayout(scrollOffsets: { clone: Element }[]) {
    if (width >= 768) return
    const regions = document.querySelectorAll<HTMLElement>(
      "[data-liquid-layout-section], [data-liquid-layout-row]"
    )
    if (!regions.length) return

    const root = document.documentElement
    if (
      root.clientWidth !== width ||
      root.clientHeight !== height ||
      !CSS.supports("content-visibility", "hidden")
    ) {
      return
    }

    // These in-flow blocks can reserve their measured border-box height.
    // A deferred section already skips all of its rows.
    const deferredSources = new Set<Element>()
    for (const source of regions) {
      const section = source.parentElement?.closest("[data-liquid-layout-section]")
      if (section && deferredSources.has(section)) continue
      const copy = clones.get(source)
      if (!(copy instanceof HTMLElement) || copy.style.height || copy.style.boxSizing) continue
      const rect = source.getBoundingClientRect()
      if (
        rect.height <= 0 ||
        (rect.bottom >= -LAYOUT_LOOKAHEAD_PX && rect.top <= liquidBottom + LAYOUT_LOOKAHEAD_PX)
      ) {
        continue
      }
      if (scrollOffsets.some(({ clone }) => copy.contains(clone))) continue
      copy.style.boxSizing = "border-box"
      copy.style.height = `${rect.height}px`
      copy.style.contentVisibility = "hidden"
      deferredSources.add(source)
      deferredLayout.push({ element: copy, top: rect.top + pageY, bottom: rect.bottom + pageY })
    }
  }

  function revealLayoutInView(topEdge: number, bottomEdge: number) {
    for (let index = deferredLayout.length - 1; index >= 0; index--) {
      const { element, top, bottom } = deferredLayout[index]
      if (bottom < topEdge || top > bottomEdge) continue
      element.style.removeProperty("content-visibility")
      element.style.removeProperty("height")
      element.style.removeProperty("box-sizing")
      deferredLayout.splice(index, 1)
    }
  }

  function restoreDeferredLayout() {
    revealLayoutInView(-Infinity, Infinity)
  }

  function syncPageScroll() {
    const { scrollX, scrollY } = window
    if (pageX !== scrollX) {
      pageX = scrollX
      stage.style.left = `${-pageX}px`
    }
    if (pageY !== scrollY) {
      pageY = scrollY
      stage.style.top = `${-pageY}px`
      revealLayoutInView(pageY - LAYOUT_LOOKAHEAD_PX, pageY + liquidBottom + LAYOUT_LOOKAHEAD_PX)
    }
  }

  function syncScroll(event: Event) {
    if (!isSourcePage()) return
    if (event.target === document || event.target === window) {
      syncPageScroll()
    } else if (event.target instanceof Element) {
      const clone = clones.get(event.target)
      if (clone) {
        restoreDeferredLayout()
        clone.scrollTop = event.target.scrollTop
        clone.scrollLeft = event.target.scrollLeft
      }
    }
  }

  return {
    mount(ready) {
      const scrollOffsets = syncInteractiveState(document.body, stage, clones)
      syncPageScroll()
      prepareDeferredLayout(scrollOffsets)
      beforeAttach?.()
      document.body.appendChild(host)
      for (const { clone, top, left } of scrollOffsets) {
        clone.scrollTop = top
        clone.scrollLeft = left
      }
      window.addEventListener("scroll", syncScroll, true)
      if (deferredLayout.length) window.addEventListener("resize", restoreDeferredLayout)
      ready()
    },
    draw(d, bottom = height) {
      if (navigationMask) navigationMask.draw(d)
      else {
        liquidBottom = bottom
        revealLayoutInView(pageY - LAYOUT_LOOKAHEAD_PX, pageY + liquidBottom + LAYOUT_LOOKAHEAD_PX)
        if (path.getAttribute("d") !== d) path.setAttribute("d", d)
      }
    },
    revealNavigation(source, d) {
      // Preserve the previous page outside the liquid. The live destination
      // now supplies the target theme within it.
      revealLayoutInView(pageY - LAYOUT_LOOKAHEAD_PX, pageY + height + LAYOUT_LOOKAHEAD_PX)
      applyAppearance(source)
      navigationMask = createLiquidMask(NAVIGATION_MASK_ID, width, height)
      navigationMask.draw(d)
      shadow.appendChild(navigationMask.svg)
      freeze.style.setProperty("-webkit-mask-image", navigationMask.image)
      freeze.style.maskImage = navigationMask.image
      freeze.style.clipPath = "none"
    },
    dispose() {
      window.removeEventListener("scroll", syncScroll, true)
      window.removeEventListener("resize", restoreDeferredLayout)
      host.remove()
    },
  }
}

export function startLiquidReveal(options: StartLiquidRevealOptions): LiquidRevealHandle | null {
  if (typeof document === "undefined") return null
  if (prefersReducedMotion()) return null

  const {
    targetAppearance,
    origin,
    duration = DEFAULT_LIQUID_DURATION,
    onBegin,
    onPhase,
    onCommit,
    onAbort,
  } = options

  // Never run two reveals concurrently — the newer request wins.
  activeHandle?.cancel("superseded")
  activeHandle = null

  const root = document.documentElement
  const sourceAppearance = root.classList.contains("dark") ? "dark" : "light"
  const sourcePathname = window.location.pathname
  let navigated = false
  const isSourcePage = () => !navigated && window.location.pathname === sourcePathname
  const width = root.clientWidth || window.innerWidth
  const height = root.clientHeight || window.innerHeight
  const clamped = clampOrigin(origin, width, height)
  const sequence = createLiquidSequence(
    { width, height, originX: clamped.x, originY: clamped.y },
    planTimeline(duration)
  )

  function appearance(): string {
    const { classList, style } = root
    return `${classList.contains("light")}:${classList.contains("dark")}:${style.colorScheme}`
  }

  function createOverlay(beforeAttach?: () => void): LiquidSurface | null {
    if (!isLiquidRevealSupported()) return null
    try {
      return createDomSurface(targetAppearance, width, height, isSourcePage, beforeAttach)
    } catch {
      return null
    }
  }

  let expectedAppearance = appearance()
  const snapshot = createSnapshotSurface(targetAppearance, width, height, () => {
    expectedAppearance = appearance()
  })
  const initialSurface = snapshot ?? createOverlay()
  if (!initialSurface) return null
  let surface: LiquidSurface = initialSurface

  let rafId = 0
  let framesStarted = false
  let previousFrameAt: number | undefined
  let lastFrameActivity = performance.now()
  let elapsed = 0
  let currentPath = "M0 0Z"
  let currentBottom = 0
  let lastPhaseIndex = -1
  let restoreNavigationAppearance: (() => void) | undefined
  let finished = false
  let tornDown = false
  let settleTimeout: ReturnType<typeof setTimeout> | undefined

  const cleanupListeners = registerAbortListeners()

  function teardown(): void {
    if (tornDown) return
    tornDown = true
    cancelAnimationFrame(rafId)
    clearInterval(watchdogId)
    clearTimeout(settleTimeout)
    cleanupListeners()
    surface.dispose()
    restoreNavigationAppearance?.()
    if (activeHandle === handle) activeHandle = null
  }

  function finish(): void {
    if (finished) return
    finished = true
    cleanupListeners()
    cancelAnimationFrame(rafId)
    clearInterval(watchdogId)
    if (onCommit) {
      surface.keepTarget?.()
      restoreNavigationAppearance = undefined
      onCommit()
    }
    settleTimeout = setTimeout(teardown, 120)
  }

  // Occluded windows and backgrounded ArkWeb pages can stall rAF entirely
  // while visibilityState still reports "visible". Commit the accepted theme
  // and release the unfinished overlay.
  const watchdogId = setInterval(() => {
    if (performance.now() - lastFrameActivity >= STALLED_FRAME_TIMEOUT_MS) cancel("timeout")
  }, 500)

  function cancel(reason: LiquidAbortReason, commit?: boolean): void {
    if (tornDown) return
    const keepTarget = commit ?? shouldCommitOnAbort(reason)
    if (!finished && keepTarget && onAbort) {
      surface.keepTarget?.()
      restoreNavigationAppearance = undefined
    }
    teardown()
    if (!finished) onAbort?.(reason, keepTarget)
  }

  const handle: LiquidRevealHandle = { cancel, revealNavigation }

  function revealNavigation() {
    if (tornDown || finished || navigated || window.location.pathname === sourcePathname) return
    navigated = true
    if (surface.revealNavigation) {
      surface.revealNavigation(sourceAppearance, currentPath)
      restoreNavigationAppearance = previewLiquidAppearance(targetAppearance, () => {
        expectedAppearance = appearance()
      })
    }
  }

  function onFrame(ts: number): void {
    if (finished || tornDown) return
    lastFrameActivity = performance.now()
    elapsed = advanceLiquidElapsed(elapsed, ts - (previousFrameAt ?? ts))
    previousFrameAt = ts
    const frame = sequence.frame(elapsed)
    if (frame.d !== currentPath) {
      currentPath = frame.d
      currentBottom = frame.bottom
      surface.draw(currentPath, currentBottom)
    }
    if (frame.phaseIndex > lastPhaseIndex) {
      for (let i = lastPhaseIndex + 1; i <= frame.phaseIndex; i++) {
        onPhase?.(LIQUID_PHASES[i])
      }
      lastPhaseIndex = frame.phaseIndex
    }
    if (frame.done) {
      finish()
      return
    }
    rafId = requestAnimationFrame(onFrame)
  }

  function startFrames() {
    if (tornDown || framesStarted) return
    framesStarted = true
    onBegin?.(liquidDirection(targetAppearance))
    rafId = requestAnimationFrame(onFrame)
  }

  function continueWithOverlay() {
    if (!snapshot || surface !== snapshot || tornDown || finished || !isSourcePage()) return
    if (lastPhaseIndex === LIQUID_PHASES.length - 1) return

    // The static old image cannot follow the user's scroll or new viewport.
    // Copy the current layout before restoring the source theme, so the copy
    // does not force layout after the live page changes theme.
    const overlay = createOverlay(() => snapshot.dispose())
    if (!overlay) {
      cancel("geometry")
      return
    }
    try {
      overlay.draw(currentPath, currentBottom)
      overlay.mount(
        () => {
          surface = overlay
          window.removeEventListener("scroll", continueWithOverlay, true)
          window.removeEventListener("resize", continueWithOverlay)
          startFrames()
        },
        () => cancel("geometry")
      )
    } catch {
      overlay.dispose()
      cancel("geometry")
    }
  }

  activeHandle = handle
  surface.mount(startFrames, continueWithOverlay)
  return handle

  /** Page interaction leaves the animation clock running. */
  function registerAbortListeners(): () => void {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") cancel("hidden")
    }
    const onPageHide = () => cancel("hidden")
    const observer = new MutationObserver(() => {
      if (appearance() !== expectedAppearance) cancel("external-theme")
    })
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style"],
    })

    if (snapshot) {
      window.addEventListener("resize", continueWithOverlay)
      window.addEventListener("scroll", continueWithOverlay, true)
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", onPageHide)

    return () => {
      window.removeEventListener("resize", continueWithOverlay)
      window.removeEventListener("scroll", continueWithOverlay, true)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", onPageHide)
      observer.disconnect()
    }
  }
}
