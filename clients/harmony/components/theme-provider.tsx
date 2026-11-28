"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import { harmonyCall, isHarmony } from "@/lib/native/harmony"
import {
  hasThemeSwitchController,
  findVisibleThemeOrigin,
  registerThemeSwitchController,
  requestUserThemeChange,
  type ThemePreference,
} from "@/lib/theme/theme-switch"
import type { LiquidAppearance, LiquidOrigin } from "@/lib/theme/liquid-core"
import {
  prepareLiquidOverlayStyles,
  startLiquidReveal,
  type LiquidRevealHandle,
} from "@/lib/theme/liquid-reveal"

function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      <HarmonyAppearanceSync />
      <LiquidThemeController />
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  )
}

function HarmonyAppearanceSync() {
  const { resolvedTheme } = useTheme()

  React.useEffect(() => {
    if (!isHarmony()) return
    let active = true
    let revision = 0
    const syncSafeArea = () => {
      const current = ++revision
      void harmonyCall<Record<"top" | "right" | "bottom" | "left", number>>(
        "appearance.getSafeArea"
      )
        .then((insets) => {
          if (!active || current !== revision) return
          const edges = ["top", "right", "bottom", "left"] as const
          if (edges.some((edge) => !Number.isFinite(insets[edge]) || insets[edge] < 0)) return
          const ratio = window.devicePixelRatio || 1
          const root = document.documentElement
          for (const edge of edges) {
            root.style.setProperty(`--safe-area-inset-${edge}`, `${insets[edge] / ratio}px`)
          }
          root.setAttribute("data-harmony-edge-to-edge", "true")
        })
        .catch(() => {})
    }
    syncSafeArea()
    window.addEventListener("resize", syncSafeArea)
    window.addEventListener("ysu-native-safe-area", syncSafeArea)
    return () => {
      active = false
      window.removeEventListener("resize", syncSafeArea)
      window.removeEventListener("ysu-native-safe-area", syncSafeArea)
    }
  }, [])

  React.useEffect(() => {
    if (!isHarmony() || (resolvedTheme !== "light" && resolvedTheme !== "dark")) return

    void harmonyCall("appearance.setTheme", { theme: resolvedTheme }).catch(() => {})
  }, [resolvedTheme])

  return null
}

interface ActiveReveal {
  handle: LiquidRevealHandle
  target: LiquidAppearance
}

/**
 * Bridges user-initiated theme requests onto next-themes. The temporary
 * liquid layer never writes preferences or pokes the native appearance —
 * the real theme (and therefore HarmonyAppearanceSync) commits exactly once
 * when the visual finishes, or immediately when no animation runs.
 */
function LiquidThemeController() {
  const activeRef = React.useRef<ActiveReveal | null>(null)
  const pendingPrefRef = React.useRef<ThemePreference>("system")
  const themeStateRef = React.useRef<{
    resolved: string | undefined
    system: string | undefined
    setTheme: (pref: ThemePreference) => void
  }>({
    resolved: undefined,
    system: undefined,
    setTheme: () => {},
  })

  const { resolvedTheme, systemTheme, setTheme } = useTheme()
  const pathname = usePathname()
  React.useEffect(() => prepareLiquidOverlayStyles(), [pathname])
  React.useLayoutEffect(() => {
    activeRef.current?.handle.revealNavigation()
  }, [pathname])
  React.useLayoutEffect(() => {
    themeStateRef.current = {
      resolved: resolvedTheme,
      system: systemTheme,
      setTheme,
    }
  }, [resolvedTheme, systemTheme, setTheme])

  React.useEffect(() => {
    registerThemeSwitchController({
      request({ pref, origin }) {
        const state = themeStateRef.current
        const current = (state.resolved ?? "light") as LiquidAppearance
        const target = ((pref === "system" ? state.system ?? current : pref) ??
          "light") as LiquidAppearance

        const running = activeRef.current
        if (running) {
          if (running.target === target) pendingPrefRef.current = pref
          return
        }

        pendingPrefRef.current = pref
        const commit = () => state.setTheme(pendingPrefRef.current)

        if (target === current) {
          // Appearance unchanged (e.g. picking 跟随系统): persist the
          // preference without playing the transition.
          commit()
          return
        }

        let ended = false
        function settle(doCommit: boolean) {
          ended = true
          activeRef.current = null
          if (doCommit) commit()
        }

        const reveal = startLiquidReveal({
          targetAppearance: target,
          origin: resolveOrigin(origin),
          onCommit: () => settle(true),
          onAbort: (_, doCommit) => settle(doCommit),
        })

        if (!reveal) {
          // Reduced motion or an unavailable reveal switches the theme directly.
          commit()
          return
        }
        if (!ended) activeRef.current = { handle: reveal, target }
      },
    })
    return () => {
      registerThemeSwitchController(null)
      activeRef.current?.handle.cancel("unmount")
      activeRef.current = null
    }
  }, [])

  return null
}

function resolveOrigin(origin: LiquidOrigin | null | undefined): LiquidOrigin | null {
  return origin ?? findVisibleThemeOrigin()
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.key.toLowerCase() !== "d") {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      const next = resolvedTheme === "dark" ? "light" : "dark"
      if (hasThemeSwitchController()) {
        // Origin: a visible theme control if the page has one, otherwise the
        // controller falls back to the viewport top-center stream.
        requestUserThemeChange(next)
      } else {
        setTheme(next)
      }
    }

    window.addEventListener("keydown", onKeyDown)

    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

export { ThemeProvider }
