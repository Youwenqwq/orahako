"use client"

import { useLayoutEffect, useRef } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Calendar, GraduationCap, LayoutDashboard, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useProviderCapabilities } from "@/providers/use-provider"
import { hasCapability } from "@/providers/capabilities"
import type { AcademicCapabilities } from "@/providers/types"

export function MobileBottomNav() {
  const rawPathname = usePathname()
  const pathname = rawPathname.replace(/\/$/, "")
  const { t } = useTranslation()
  const dockRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const dock = dockRef.current
    if (!dock) return
    const root = document.documentElement
    // Include the gap and safe area below the pill in the layout clearance.
    const updateHeight = () => {
      root.style.setProperty(
        "--mobile-bottom-nav-height",
        `${dock.getBoundingClientRect().height}px`
      )
    }
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(dock, { box: "border-box" })
    return () => {
      observer.disconnect()
      root.style.removeProperty("--mobile-bottom-nav-height")
    }
  }, [])

  const capabilities = useProviderCapabilities()
  const tabs = [
    { href: "/dashboard", label: t("app.overview"), icon: LayoutDashboard },
    {
      href: "/dashboard/schedule",
      label: t("app.schedule"),
      icon: Calendar,
      capability: "schedule",
    },
    {
      href: "/dashboard/grades",
      label: t("app.grades"),
      icon: GraduationCap,
      capability: "grades",
    },
    { href: "/dashboard/me", label: t("app.me"), icon: User },
  ].filter(
    (tab) =>
      !("capability" in tab) ||
      hasCapability(capabilities, tab.capability as keyof AcademicCapabilities)
  )

  return (
    <div
      ref={dockRef}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 pr-[calc(1rem+var(--safe-area-inset-right,env(safe-area-inset-right,0px)))] pb-[var(--mobile-bottom-nav-bottom-space)] pl-[calc(1rem+var(--safe-area-inset-left,env(safe-area-inset-left,0px)))] md:hidden"
    >
      <nav
        className="mobile-bottom-nav-glass pointer-events-auto grid min-h-16 rounded-full border px-3"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        aria-label="Primary"
      >
        {tabs.map((tab) => {
          const isActive =
            tab.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === tab.href || pathname.startsWith(`${tab.href}/`)
          const Icon = tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-full px-1 py-2 text-center text-xs leading-4 text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
                isActive ? "font-semibold" : "font-medium"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="size-[22px] shrink-0" strokeWidth={isActive ? 2.5 : 2} />
              <span>{tab.label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
