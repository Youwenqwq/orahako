"use client"

import { useEffect, useState } from "react"
import { CalendarDays, ClipboardList } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useTranslation } from "@/lib/i18n/use-translation"
import { isHarmony } from "@/lib/native/platform"
import {
  openHarmonyWidgetManager,
  syncExamsToWidget,
  syncWidgetSettingsToWidget,
  type HarmonyWidgetKind,
} from "@/lib/native/widget-bridge"
import { useSettingsStore } from "@/lib/stores/settings"
import { useExams } from "@/providers/hooks"

export default function WidgetSettingsPage() {
  return isHarmony() ? <HarmonyWidgetSettings /> : null
}

function HarmonyWidgetSettings() {
  const { t } = useTranslation()
  const hours = useSettingsStore((s) => s.widgetSyncReminderHours)
  const showNextDay = useSettingsStore((s) => s.widgetShowNextDaySchedule)
  const setHours = useSettingsStore((s) => s.setWidgetSyncReminderHours)
  const setShowNextDay = useSettingsStore((s) => s.setWidgetShowNextDaySchedule)
  const [opening, setOpening] = useState(false)
  const [saving, setSaving] = useState(false)
  const { data: exams } = useExams()

  useEffect(() => {
    if (exams) void syncExamsToWidget(exams).catch(() => {})
  }, [exams])

  async function openManager(kind: HarmonyWidgetKind, compact: boolean) {
    setOpening(true)
    try {
      if (kind === "exams" && exams) {
        await syncExamsToWidget(exams).catch(() => toast.error(t("settings.widgetExamSyncFailed")))
      }
      await openHarmonyWidgetManager(compact, kind)
    } catch {
      toast.error(t("schedule.widgetAssistantManual"))
    } finally {
      setOpening(false)
    }
  }

  async function save(nextHours: number, nextShowNextDay: boolean) {
    setSaving(true)
    try {
      await syncWidgetSettingsToWidget(nextHours, nextShowNextDay)
      setHours(nextHours)
      setShowNextDay(nextShowNextDay)
    } catch {
      toast.error(t("settings.widgetSettingsSaveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const widgets = [
    {
      kind: "schedule",
      icon: CalendarDays,
      title: t("settings.widgetScheduleTitle"),
      description: t("settings.widgetScheduleDescription"),
    },
    {
      kind: "exams",
      icon: ClipboardList,
      title: t("settings.widgetExamTitle"),
      description: t("settings.widgetExamDescription"),
    },
  ] as const
  const hourOptions = [...new Set([0, 6, 12, 24, 48, 72, 168, hours])].sort((a, b) => a - b)

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{t("settings.widget")}</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {widgets.map(({ kind, icon: Icon, title, description }) => (
          <Card key={kind}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon className="size-4 text-muted-foreground" />
                {title}
              </CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={opening}
                onClick={() => openManager(kind, true)}
                aria-label={`${title} ${t("schedule.widgetAssistantCompact")}`}
              >
                {t("schedule.widgetAssistantCompact")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={opening}
                onClick={() => openManager(kind, false)}
                aria-label={`${title} ${t("schedule.widgetAssistantWide")}`}
              >
                {t("schedule.widgetAssistantWide")}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <label htmlFor="widget-sync-reminder" className="font-medium">
                {t("settings.widgetSyncReminder")}
              </label>
              <p id="widget-sync-description" className="text-xs text-muted-foreground">
                {t("settings.widgetSyncReminderDesc")}
              </p>
            </div>
            <Select
              value={String(hours)}
              disabled={saving}
              onValueChange={(value) => save(Number(value), showNextDay)}
            >
              <SelectTrigger id="widget-sync-reminder" aria-describedby="widget-sync-description">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hourOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option === 0
                      ? t("settings.widgetSyncReminderOff")
                      : `${option} ${t("settings.widgetSyncReminderUnit")}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
            <div>
              <label htmlFor="widget-show-next-day" className="font-medium">
                {t("settings.widgetShowNextDay")}
              </label>
              <p id="widget-next-day-description" className="text-xs text-muted-foreground">
                {t("settings.widgetShowNextDayDesc")}
              </p>
            </div>
            <Switch
              id="widget-show-next-day"
              aria-describedby="widget-next-day-description"
              checked={showNextDay}
              disabled={saving}
              onCheckedChange={(value) => save(hours, value)}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
