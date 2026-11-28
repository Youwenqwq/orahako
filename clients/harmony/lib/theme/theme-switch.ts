/**
 * Shared registry between the theme entries (me-page sun/moon button,
 * settings page options, D hotkey) and the controller living inside
 * ThemeProvider. Entries never import React context — they call the module
 * function, the controller resolves next-themes state and runs the liquid
 * reveal with the audio adapter.
 */

import type { LiquidOrigin } from "./liquid-core"

export type ThemePreference = "light" | "dark" | "system"

export interface ThemeSwitchRequest {
  pref: ThemePreference
  /** Origin measured from the triggering control's bottom-edge center. */
  origin?: LiquidOrigin | null
}

export interface ThemeSwitchController {
  request(req: ThemeSwitchRequest): void
}

let controller: ThemeSwitchController | null = null

export function registerThemeSwitchController(next: ThemeSwitchController | null): void {
  controller = next
}

export function hasThemeSwitchController(): boolean {
  return controller !== null
}

export function requestUserThemeChange(pref: ThemePreference, origin?: LiquidOrigin | null): void {
  controller?.request({ pref, origin })
}

/**
 * Find the origin of a visible theme control, optionally matching a specific
 * `data-liquid-origin` value (the settings page marks each option; the
 * me-page button is marked too so the D hotkey can start from it). Keyboard
 * activation on the toggle items resolves through the same lookup.
 */
export function findVisibleThemeOrigin(value?: string): LiquidOrigin | null {
  if (typeof document === "undefined") return null
  const selector =
    value !== undefined ? `[data-liquid-origin="${value}"]` : "[data-liquid-origin]"
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 && rect.height <= 0) continue
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue
    if (rect.right < 0 || rect.left > window.innerWidth) continue
    return {
      x: rect.left + rect.width / 2,
      y: Math.min(rect.bottom, window.innerHeight - 4),
    }
  }
  return null
}
