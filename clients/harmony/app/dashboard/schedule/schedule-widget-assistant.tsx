"use client"

import { useId, useState } from "react"
import Image from "next/image"
import { Popover } from "radix-ui"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { BackLayer } from "@/hooks/use-back-handler"
import { useTranslation } from "@/lib/i18n/use-translation"
import { openHarmonyWidgetManager } from "@/lib/native/widget-bridge"
import buroImage from "@/public/widgets/buro.png"

export function ScheduleWidgetAssistant({ syncSchedule }: { syncSchedule: () => Promise<void> }) {
  const { t } = useTranslation()
  const headingId = useId()
  const instructionsId = useId()
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const [showManualHint, setShowManualHint] = useState(false)

  async function openManager(compact: boolean) {
    setOpening(true)
    setShowManualHint(false)
    try {
      await syncSchedule().catch(() => toast.error(t("schedule.widgetAssistantSyncFailed")))
      await openHarmonyWidgetManager(compact)
      setOpen(false)
    } catch {
      setShowManualHint(true)
    } finally {
      setOpening(false)
    }
  }

  return (
    <BackLayer enabled={open} onBack={() => setOpen(false)}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={t("schedule.widgetAssistantTitle")}
            className="fixed right-4 bottom-[calc(var(--mobile-bottom-nav-height)+1rem)] z-40 block size-14 rounded-full select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:right-6 md:bottom-6 md:size-16"
          >
            <Image
              src={buroImage}
              alt=""
              draggable={false}
              className="pointer-events-none size-full object-contain drop-shadow-md"
            />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="end"
            sideOffset={10}
            collisionPadding={16}
            aria-labelledby={headingId}
            aria-describedby={instructionsId}
            className="z-50 w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
          >
            <h2 id={headingId} className="text-sm font-semibold">
              {t("schedule.widgetAssistantTitle")}
            </h2>
            <p id={instructionsId} className="text-sm leading-relaxed text-muted-foreground">
              {t("schedule.widgetAssistantSteps")}
            </p>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => openManager(true)} disabled={opening}>
                {t("schedule.widgetAssistantCompact")}
              </Button>
              <Button type="button" size="sm" onClick={() => openManager(false)} disabled={opening}>
                {t("schedule.widgetAssistantWide")}
              </Button>
            </div>
            {showManualHint && (
              <p role="status" className="text-xs text-muted-foreground">
                {t("schedule.widgetAssistantManual")}
              </p>
            )}
            <Popover.Arrow className="fill-popover" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </BackLayer>
  )
}
