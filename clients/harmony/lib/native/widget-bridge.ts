import { registerPlugin } from "@capacitor/core"
import type { Course, CurrentWeek, ClassPeriod, Exam, TermCalendar } from "@/providers/types"
import { parseWeeks } from "@/app/dashboard/schedule/schedule-utils"
import { getAcademicClock, resolveAcademicWeek } from "@/lib/academic/academic-time"
import { getExamEndTime, getExamStartTime } from "@/lib/academic/exam-utils"
import { useAuthStore } from "@/lib/stores/auth"
import { harmonyCall, isHarmony } from "./harmony"

export interface WidgetBridgePlugin {
  syncSchedule(options: {
    coursesJson: string
    currentWeekJson: string
    syncReminderHours: number
    showNextDaySchedule: boolean
  }): Promise<void>
  syncExams(options: { examsJson: string; syncReminderHours: number }): Promise<void>
  syncWidgetSettings(options: {
    syncReminderHours: number
    showNextDaySchedule: boolean
  }): Promise<void>
  clearWidgetData(): Promise<void>
}

const WidgetBridge = registerPlugin<WidgetBridgePlugin>("WidgetBridge", {
  web: async () => {
    return {
      async syncSchedule() {
        // No-op on web
      },
      async syncExams() {
        // No-op on web
      },
      async syncWidgetSettings() {
        // No-op on web
      },
      async clearWidgetData() {
        // No-op on web
      },
    }
  },
})

export interface WidgetCourse {
  name: string
  classroom?: string
  week_day: number
  week_list: number[]
  start_section: number
  end_section: number
  start_time?: string
  end_time?: string
}

export interface WidgetWeekInfo {
  week: number
  weekday: number
  term?: string
  date?: string
  full_schedule: boolean
  total_weeks?: number
}

export interface WidgetExam {
  name: string
  exam_name?: string
  start_at?: string
  end_at?: string
  time_text?: string
  exam_location?: string
  seat_number?: string
}

export type HarmonyWidgetKind = "schedule" | "exams"
let widgetQueue: Promise<void> = Promise.resolve()

function queueWidgetOperation(task: () => Promise<void>): Promise<void> {
  const operation = widgetQueue.then(task)
  widgetQueue = operation.catch(() => {})
  return operation
}

function syncHarmonyWidget(method: string, params: object): Promise<void> {
  return queueWidgetOperation(async () => {
    if (!useAuthStore.getState().isAuthenticated) return
    await harmonyCall(method, params)
  })
}

function groupHarmonyWidgetCourses(courses: WidgetCourse[]): WidgetCourse[] {
  const grouped = new Map<string, WidgetCourse>()
  // Schedule adjustments expand recurring classes into one row per teaching week.
  for (const course of courses) {
    const name = course.name.trim().slice(0, 160)
    const { week_day, start_section, end_section } = course
    if (
      !name ||
      !Number.isInteger(week_day) ||
      week_day < 1 ||
      week_day > 7 ||
      !Number.isInteger(start_section) ||
      !Number.isInteger(end_section) ||
      start_section < 1 ||
      end_section < start_section
    )
      continue

    const classroom = course.classroom?.trim().slice(0, 100) || undefined
    const end_time = course.end_time?.trim().slice(0, 24) || undefined
    const key = JSON.stringify([name, classroom, week_day, start_section, end_section, end_time])
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, {
        name,
        classroom,
        week_day,
        start_section,
        end_section,
        end_time,
        week_list: course.week_list,
      })
    } else {
      existing.week_list =
        existing.week_list.length && course.week_list.length
          ? [...new Set([...existing.week_list, ...course.week_list])]
          : []
    }
  }
  return [...grouped.values()]
}

export async function syncScheduleToWidget(
  courses: Course[],
  currentWeek: CurrentWeek | null,
  periods: ClassPeriod[],
  syncReminderHours: number = 24,
  showNextDaySchedule: boolean = false,
  calendar?: TermCalendar
): Promise<void> {
  const harmony = isHarmony()
  if (harmony && !useAuthStore.getState().isAuthenticated) return
  try {
    const periodMap = new Map(periods.map((p) => [p.section, p]))

    const widgetCourses: WidgetCourse[] = courses.map((c) => {
      const startSection = c.startSection
      const endSection = c.endSection
      const startPeriod = periodMap.get(startSection)
      const endPeriod = periodMap.get(endSection)
      return {
        name: c.name,
        classroom: c.classroom,
        week_day: c.weekDay,
        week_list: c.weekList ?? parseWeeks(c.weeks || ""),
        start_section: startSection,
        end_section: endSection,
        start_time: startPeriod?.startTime,
        end_time: endPeriod?.endTime,
      }
    })

    const liveWeek = resolveAcademicWeek(
      currentWeek,
      calendar,
      getAcademicClock().date,
      currentWeek?.semester
    )
    const matchingCalendar =
      calendar &&
      (!calendar.semester || !liveWeek?.semester || calendar.semester === liveWeek.semester)
        ? calendar
        : undefined
    const weekInfo: WidgetWeekInfo | null = liveWeek
      ? {
          week: liveWeek.week,
          weekday: liveWeek.weekday,
          term: liveWeek.semester,
          date: liveWeek.date,
          total_weeks: matchingCalendar
            ? (matchingCalendar.totalWeeks > 0
                ? matchingCalendar.totalWeeks
                : matchingCalendar.teachingWeeks) || undefined
            : undefined,
          full_schedule: true,
        }
      : null

    if (harmony) {
      await syncHarmonyWidget("scheduleWidget.sync", {
        scheduleSnapshot: JSON.stringify({
          courses: groupHarmonyWidgetCourses(widgetCourses),
          week: weekInfo && {
            week: weekInfo.week,
            weekday: weekInfo.weekday,
            date: weekInfo.date,
            total_weeks: weekInfo.total_weeks,
          },
          showNextDay: showNextDaySchedule,
        }),
      })
      return
    }
    await WidgetBridge.syncSchedule({
      coursesJson: JSON.stringify(widgetCourses),
      currentWeekJson: weekInfo ? JSON.stringify(weekInfo) : "",
      syncReminderHours,
      showNextDaySchedule,
    })
  } catch (error) {
    if (harmony) throw error
    // Widget sync is best-effort; fail silently
  }
}

export async function syncWidgetSettingsToWidget(
  syncReminderHours: number,
  showNextDaySchedule: boolean = false
): Promise<void> {
  if (isHarmony()) {
    await queueWidgetOperation(() =>
      harmonyCall("scheduleWidget.settings", { syncReminderHours, showNextDaySchedule })
    )
    return
  }
  try {
    await WidgetBridge.syncWidgetSettings({
      syncReminderHours,
      showNextDaySchedule,
    })
  } catch {
    // Widget sync is best-effort; fail silently
  }
}

export async function syncExamsToWidget(
  exams: Exam[],
  syncReminderHours: number = 24
): Promise<void> {
  if (isHarmony()) {
    const entries = exams.flatMap((exam) => {
      const name = (exam.name.trim() || exam.examName?.trim())?.slice(0, 160)
      const start = getExamStartTime(exam)?.getTime()
      const end = getExamEndTime(exam)?.getTime()
      if (!name || (end === undefined && exam.status === "completed")) return []
      return [
        {
          name,
          start,
          end,
          timeText: start === undefined ? exam.timeText?.trim().slice(0, 120) : undefined,
          location: exam.examLocation?.trim().slice(0, 100),
          seat: exam.seatNumber?.trim().slice(0, 32),
        },
      ]
    })
    await syncHarmonyWidget("examWidget.sync", { examSnapshot: JSON.stringify({ exams: entries }) })
    return
  }
  try {
    const widgetExams: WidgetExam[] = exams.map((e) => ({
      name: e.name,
      exam_name: e.examName,
      start_at: e.startAt,
      end_at: e.endAt,
      time_text: e.timeText,
      exam_location: e.examLocation,
      seat_number: e.seatNumber,
    }))

    await WidgetBridge.syncExams({
      examsJson: JSON.stringify(widgetExams),
      syncReminderHours,
    })
  } catch {
    // Widget sync is best-effort; fail silently
  }
}
export async function clearWidgetDataFromNative(): Promise<void> {
  try {
    if (isHarmony()) {
      await queueWidgetOperation(() => harmonyCall("scheduleWidget.clear"))
    } else await WidgetBridge.clearWidgetData()
  } catch {
    // Widget cache cleanup is best-effort; fail silently
  }
}

export function openHarmonyWidgetManager(
  compact: boolean,
  kind: HarmonyWidgetKind = "schedule"
): Promise<void> {
  return harmonyCall("scheduleWidget.openManager", { compact, exam: kind === "exams" })
}
