"use client"

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, GripVertical, History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useBackHandler } from "@/hooks/use-back-handler"
import { BACK_PRIORITY } from "@/lib/navigation/back"
import { cn } from "@/lib/utils"
import {
  scheduleDate,
  scheduleWeek,
  type ScheduleDrop,
  type ScheduleOccurrence,
  type SchedulePatch,
  type ScheduleSelection,
  type ScheduleTrace,
} from "@/lib/academic/schedule-patches"
import type { Course } from "@/providers/types"

interface ScheduleDragProviderProps {
  enabled: boolean
  editing: boolean
  patches: SchedulePatch[]
  selectedWeek: number
  totalWeeks: number
  termStartDate: string
  courses: ScheduleOccurrence[]
  traces: ScheduleTrace[]
  onShiftWeek: (delta: number) => void
  onDrop: (drop: ScheduleDrop) => void
  onSelect: (selection: ScheduleSelection) => void
  onTraceClick: (patchId: string) => void
  children: ReactNode
}

interface ScheduleEditorValue {
  enabled: boolean
  editing: boolean
  adjustedDates: ReadonlySet<string>
  adjustedCourses: ReadonlySet<string>
  coursePatchIds: ReadonlySet<string>
  termStartDate: string
  traces: ScheduleTrace[]
  courses: ScheduleOccurrence[]
  isDragging: () => boolean
  selectCourse: (course: Course) => boolean
  selectDay: (date: string) => void
  onTraceClick: (id: string) => void
}

const ScheduleEditorContext = createContext<ScheduleEditorValue>({
  enabled: false,
  editing: false,
  adjustedDates: new Set(),
  adjustedCourses: new Set(),
  coursePatchIds: new Set(),
  termStartDate: "",
  traces: [],
  courses: [],
  isDragging: () => false,
  selectCourse: () => false,
  selectDay: () => {},
  onTraceClick: () => {},
})

export function useScheduleEditor() {
  return useContext(ScheduleEditorContext)
}

export function scheduleOccurrence(course: Course): ScheduleOccurrence | null {
  return "occurrenceId" in course && "source" in course ? (course as ScheduleOccurrence) : null
}

export function courseHasScheduleTrace(course: Course, traces: ScheduleTrace[]): boolean {
  const occurrence = scheduleOccurrence(course)
  return (
    !!occurrence &&
    traces.some(
      (trace) =>
        trace.date === occurrence.date &&
        trace.startSection <= course.endSection &&
        trace.endSection >= course.startSection
    )
  )
}

interface Gesture {
  selection: ScheduleSelection
  touchId: number | null
  originX: number
  originY: number
  x: number
  y: number
  active: boolean
  moved: boolean
  edge: number
  edgeAt: number
}

interface CachedColumn {
  left: number
  right: number
  date: string
  /** 该列实际存在的节次编号（升序），保留午休间隔与缺失节次。 */
  sections: number[]
}

interface CachedRow {
  section: number
  top: number
  bottom: number
}

/** 拖拽启动时一次性捕获的网格几何快照，帧内命中测试全部基于它。 */
interface CachedGrid {
  week: number
  grid: HTMLElement
  gridWidth: number
  gridHeight: number
  /** 实际滚动容器；null 表示滚动发生在文档视口。 */
  scroll: HTMLElement | null
  /** 滚动容器在捕获时刻的视口上下边界（拖拽期间保持不变）。 */
  scrollCapTop: number
  scrollCapBottom: number
  capturedScrollTop: number
  capturedWindowY: number
  hostLeft: number
  hostRight: number
  gridTop: number
  gridBottom: number
  columns: CachedColumn[]
  rows: CachedRow[]
}

/**
 * 捕获当前周网格的几何快照：7 列边界、各节次行边界与日期。只在拖拽启动、
 * 切周或网格尺寸变化时调用一次，拖拽帧内不再查询或读取布局。
 */
function measureGrid(host: HTMLElement, week: number): CachedGrid | null {
  const grid = Array.from(
    host.querySelectorAll<HTMLElement>(`[data-schedule-grid="${week}"]`)
  ).find((el) => el.getBoundingClientRect().width > 0)
  if (!grid) return null
  let scroll: HTMLElement | null = grid.parentElement
  while (
    scroll &&
    !(
      scroll.scrollHeight > scroll.clientHeight &&
      /auto|scroll/.test(getComputedStyle(scroll).overflowY)
    )
  )
    scroll = scroll.parentElement
  const scrollRect = scroll?.getBoundingClientRect()
  const hostRect = host.getBoundingClientRect()
  const gridRect = grid.getBoundingClientRect()
  const columns = new Map<number, CachedColumn>()
  const rows = new Map<number, CachedRow>()
  for (const cell of grid.querySelectorAll<HTMLElement>("[data-schedule-section]")) {
    const rect = cell.getBoundingClientRect()
    if (rect.width <= 0 && rect.height <= 0) continue
    const section = Number(cell.dataset.scheduleSection)
    const left = Math.round(rect.left)
    let column = columns.get(left)
    if (!column) {
      column = {
        left: rect.left,
        right: rect.right,
        date: cell.dataset.scheduleDate ?? "",
        sections: [],
      }
      columns.set(left, column)
    }
    column.sections.push(section)
    if (!rows.has(section)) rows.set(section, { section, top: rect.top, bottom: rect.bottom })
  }
  return {
    week,
    grid,
    gridWidth: gridRect.width,
    gridHeight: gridRect.height,
    scroll,
    scrollCapTop: Math.max(0, scrollRect?.top ?? 0),
    scrollCapBottom: Math.min(window.innerHeight, scrollRect?.bottom ?? window.innerHeight),
    capturedScrollTop: scroll?.scrollTop ?? 0,
    capturedWindowY: window.scrollY,
    hostLeft: Math.max(0, hostRect.left),
    hostRight: Math.min(window.innerWidth, hostRect.right),
    gridTop: gridRect.top,
    gridBottom: gridRect.bottom,
    columns: [...columns.values()].sort((a, b) => a.left - b.left),
    rows: [...rows.values()].sort((a, b) => a.top - b.top),
  }
}

/** Native capture listeners let a long press claim touch movement without disabling early scrolling. */
export function ScheduleDragProvider(props: ScheduleDragProviderProps) {
  const { t } = useTranslation()
  const latest = useRef(props)
  useLayoutEffect(() => {
    latest.current = props
  }, [props])
  const root = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const cancelGesture = useRef<(() => void) | null>(null)
  const [hasGesture, setHasGesture] = useState(false)
  const suppressClickUntil = useRef(0)
  const overlay = useRef<HTMLDivElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<ScheduleSelection | null>(null)
  const [targetLabel, setTargetLabel] = useState<{
    date: string
    section: number
    valid: boolean
  } | null>(null)
  const [edgeDirection, setEdgeDirection] = useState(0)
  useBackHandler(
    () => cancelGesture.current?.(),
    props.enabled && hasGesture,
    BACK_PRIORITY.gesture
  )

  // Keep ghost-click suppression alive while opening a dialog disables editing.
  useEffect(() => {
    function click(event: MouseEvent) {
      if (Date.now() < suppressClickUntil.current) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener("click", click, true)
    return () => document.removeEventListener("click", click, true)
  }, [])

  useEffect(() => {
    if (!props.enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let frame = 0
    let frameScheduled = false
    let lastFrameAt = 0
    let destination: ScheduleDrop | null = null
    let labelKey = ""
    let previewKey = ""
    let touchTarget: Element | null = null
    /** 网格几何快照；拖拽帧内只读 scrollTop，不查询 DOM、不读布局。 */
    let cache: CachedGrid | null = null

    const resizeObserver = new ResizeObserver((observed) => {
      const c = cache
      if (!c) return
      const entry = observed.find((e) => e.target === c.grid)
      if (!entry) return
      if (
        Math.abs(entry.contentRect.width - c.gridWidth) < 1 &&
        Math.abs(entry.contentRect.height - c.gridHeight) < 1
      )
        return
      // 旋转 / 紧凑模式等改变网格尺寸时作废快照，下一帧重新测量。
      cache = null
      if (gesture.current?.active) scheduleFrame()
    })

    function scheduleFrame() {
      if (frameScheduled || !gesture.current?.active) return
      frameScheduled = true
      frame = requestAnimationFrame(tick)
    }

    function tick() {
      frameScheduled = false
      const now = performance.now()
      const dt = lastFrameAt > 0 ? Math.min(now - lastFrameAt, 64) : 16
      lastFrameAt = now
      if (update(true, dt) && gesture.current?.active) scheduleFrame()
    }

    function finish(commit: boolean) {
      const g = gesture.current
      clearTimeout(timer)
      if (frameScheduled) {
        cancelAnimationFrame(frame)
        frameScheduled = false
      }
      resizeObserver.disconnect()
      cache = null
      previewKey = ""
      if (touchTarget) {
        touchTarget.removeEventListener("touchmove", move, true)
        touchTarget.removeEventListener("touchend", end, true)
        touchTarget.removeEventListener("touchcancel", cancel, true)
        touchTarget = null
      }
      gesture.current = null
      setHasGesture(false)
      if (!g?.active) return
      suppressClickUntil.current = Date.now() + 450
      const drop = destination
      destination = null
      setActive(null)
      setTargetLabel(null)
      setEdgeDirection(0)
      labelKey = ""
      if (commit && drop && latest.current.enabled) latest.current.onDrop(drop)
    }

    /** 仅在"有目标 → 无目标"切换时隐藏预览，避免每帧切换 display 触发样式重算。 */
    function hidePreview() {
      if (preview.current && previewKey !== "") {
        preview.current.style.display = "none"
        previewKey = ""
      }
    }

    /** 返回 true 表示帧循环需要继续（边缘翻页停留、自动滚动或网格尚未提交）。 */
    function update(navigate: boolean, dt = 16): boolean {
      const g = gesture.current
      const host = root.current
      if (!g?.active || !host) return false
      // 先集中写入：浮层跟随指针。后续几何全部来自快照，写入与读取不再交错。
      if (overlay.current)
        overlay.current.style.transform = `translate3d(${Math.min(g.x + 12, window.innerWidth - 188)}px, ${Math.max(8, g.y - 60)}px, 0)`
      const { selectedWeek, totalWeeks } = latest.current
      // 惰性测量：首次激活、切周或几何作废后重新捕获。
      if (!cache || cache.week !== selectedWeek) {
        resizeObserver.disconnect()
        cache = measureGrid(host, selectedWeek)
        if (cache) resizeObserver.observe(cache.grid)
      }
      destination = null
      // 新周网格尚未提交（刚触发边缘翻页）：下一帧重试。
      if (!cache) {
        hidePreview()
        return true
      }
      // 普通滚动通过偏移增量修正快照坐标。
      const capturedDy =
        (cache.scroll ? cache.scroll.scrollTop - cache.capturedScrollTop : 0) +
        (window.scrollY - cache.capturedWindowY)
      const withinY =
        g.y >= Math.max(0, cache.gridTop + capturedDy) &&
        g.y <= Math.min(window.innerHeight, cache.gridBottom + capturedDy)
      let appliedScroll = 0
      let keepTicking = false
      if (navigate) {
        const rawEdge =
          g.moved && withinY && g.x >= cache.hostLeft - 16 && g.x < cache.hostLeft + 30
            ? -1
            : g.moved && withinY && g.x > cache.hostRight - 30 && g.x <= cache.hostRight + 16
              ? 1
              : 0
        const edge =
          selectedWeek + rawEdge >= 1 && selectedWeek + rawEdge <= totalWeeks ? rawEdge : 0
        const now = performance.now()
        if (edge !== g.edge) {
          g.edge = edge
          g.edgeAt = now
          setEdgeDirection(edge)
        }
        if (edge && now - g.edgeAt >= 600) {
          g.edgeAt = now + 250
          if (selectedWeek + edge >= 1 && selectedWeek + edge <= totalWeeks)
            latest.current.onShiftWeek(edge)
        }
        // 边缘停留靠帧循环计时，需持续 tick。
        if (edge) keepTicking = true
        // 自动滚动按经过时间计算位移，速度与刷新率无关。
        if (g.x >= cache.hostLeft && g.x <= cache.hostRight) {
          const direction =
            g.y < cache.scrollCapTop + 48 ? -1 : g.y > cache.scrollCapBottom - 48 ? 1 : 0
          if (direction) {
            appliedScroll = direction * 0.6 * dt
            ;(cache.scroll ?? document.scrollingElement)?.scrollBy(0, appliedScroll)
            keepTicking = true
          }
        }
      }
      const hitDy = capturedDy + appliedScroll
      const column = cache.columns.find((c) => g.x >= c.left && g.x < c.right)
      if (column && withinY && cache.rows.length > 0) {
        // 垂直距离最近的节次行；并列时取更靠上的一行。
        let nearest = cache.rows[0]!
        let bestDist = Infinity
        for (const row of cache.rows) {
          const top = row.top + hitDy
          const bottom = row.bottom + hitDy
          const distance = g.y < top ? top - g.y : g.y > bottom ? g.y - bottom : 0
          if (distance < bestDist) {
            bestDist = distance
            nearest = row
          }
        }
        const date = column.date
        const start = g.selection.kind === "day" ? 1 : nearest.section
        const course = g.selection.courses[0]
        const end =
          g.selection.kind === "day"
            ? column.sections[column.sections.length - 1]!
            : start + course.endSection - course.startSection
        const firstRow =
          g.selection.kind === "day"
            ? cache.rows.find((row) => row.section === column.sections[0])
            : nearest
        const lastRow = cache.rows.find((row) => row.section === end)
        const sourceNoop =
          date === g.selection.date &&
          (g.selection.kind === "day" || start === course.startSection)
        const sections = new Set(column.sections)
        const spans =
          g.selection.kind === "day"
            ? g.selection.courses.map((item) => [item.startSection, item.endSection])
            : [[start, end]]
        const complete = spans.every(([spanStart, spanEnd]) => {
          for (let section = spanStart; section <= spanEnd; section++)
            if (!sections.has(section)) return false
          return true
        })
        const valid = !!lastRow && complete && !sourceNoop
        if (valid)
          destination = { selection: g.selection, targetDate: date, targetStartSection: start }
        if (preview.current && firstRow) {
          const top = firstRow.top + hitDy
          const bottom = (lastRow ?? firstRow).bottom + hitDy
          const key = `${date}|${start}|${valid}|${Math.round(top)}|${Math.round(bottom - top)}|${Math.round(column.left)}`
          if (key !== previewKey) {
            previewKey = key
            Object.assign(preview.current.style, {
              display: "block",
              left: `${column.left}px`,
              top: `${top}px`,
              width: `${column.right - column.left}px`,
              height: `${bottom - top}px`,
              borderColor: valid ? "var(--primary)" : "var(--destructive)",
              background: valid
                ? "color-mix(in srgb, var(--primary) 15%, transparent)"
                : "color-mix(in srgb, var(--destructive) 12%, transparent)",
            })
          }
        }
        const key = `${date}:${start}:${valid}`
        if (key !== labelKey) {
          labelKey = key
          setTargetLabel({ date, section: start, valid })
        }
      } else {
        hidePreview()
        if (labelKey) {
          labelKey = ""
          setTargetLabel(null)
        }
      }
      return keepTicking
    }

    function activate() {
      const g = gesture.current
      if (!g || !latest.current.enabled) return
      g.active = true
      setActive(g.selection)
      lastFrameAt = performance.now()
      scheduleFrame()
    }

    function begin(event: MouseEvent | TouchEvent) {
      if (!latest.current.enabled || !(event.target instanceof Element)) return
      if (event instanceof TouchEvent && event.touches.length !== 1) {
        finish(false)
        return
      }
      if (gesture.current || (event instanceof MouseEvent && event.button !== 0)) return
      const source = event.target.closest<HTMLElement>(
        "[data-schedule-course], [data-schedule-day]"
      )
      if (!source || !root.current?.contains(source)) return
      const { courses } = latest.current
      const course = courses.find((c) => c.occurrenceId === source.dataset.scheduleCourse)
      const date = source.dataset.scheduleDay ?? course?.date
      if (!date) return
      const selection: ScheduleSelection = source.dataset.scheduleDay
        ? { kind: "day", date, courses: courses.filter((c) => c.date === date) }
        : course
          ? { kind: "course", date, courses: [course] }
          : { kind: "course", date, courses: [] }
      if (!selection.courses.length) return
      const touch = event instanceof TouchEvent ? event.touches[0] : null
      const x = touch?.clientX ?? (event as MouseEvent).clientX
      const y = touch?.clientY ?? (event as MouseEvent).clientY
      gesture.current = {
        selection,
        touchId: touch?.identifier ?? null,
        originX: x,
        originY: y,
        x,
        y,
        active: false,
        moved: false,
        edge: 0,
        edgeAt: 0,
      }
      setHasGesture(true)
      if (touch) {
        // Touch events keep their original target even after a week change detaches it.
        touchTarget = event.target
        touchTarget.addEventListener("touchmove", move, { capture: true, passive: false })
        touchTarget.addEventListener("touchend", end, { capture: true, passive: false })
        touchTarget.addEventListener("touchcancel", cancel, true)
      }
      if (touch && source.dataset.scheduleDay) {
        activate()
        event.stopPropagation()
      } else if (touch) timer = setTimeout(activate, 400)
    }

    function move(event: Event) {
      if (!(event instanceof MouseEvent || event instanceof TouchEvent)) return
      const g = gesture.current
      if (!g) return
      const touchEvent = event instanceof TouchEvent
      if (touchEvent !== (g.touchId !== null)) return
      if (touchEvent && event.touches.length !== 1) {
        finish(false)
        return
      }
      const point = touchEvent
        ? Array.from(event.touches).find((touch) => touch.identifier === g.touchId)
        : (event as MouseEvent)
      if (!point) {
        finish(false)
        return
      }
      g.x = point.clientX
      g.y = point.clientY
      if (Math.hypot(g.x - g.originX, g.y - g.originY) >= 5) g.moved = true
      if (!g.active) {
        const distance = Math.hypot(g.x - g.originX, g.y - g.originY)
        if (touchEvent && distance > 8) {
          finish(false)
          return
        }
        if (!touchEvent && distance >= 5) activate()
      }
      if (g.active) {
        event.preventDefault()
        event.stopPropagation()
        // 同一帧最多处理一次移动；手指静止时不再调度新帧。
        scheduleFrame()
      }
    }

    function end(event: Event) {
      if (!(event instanceof MouseEvent || event instanceof TouchEvent)) return
      const g = gesture.current
      if (!g || event instanceof TouchEvent !== (g.touchId !== null)) return
      if (event instanceof TouchEvent && event.touches.length > 0) {
        finish(false)
        return
      }
      const point =
        event instanceof TouchEvent
          ? Array.from(event.changedTouches).find((touch) => touch.identifier === g.touchId)
          : event
      if (point) {
        g.x = point.clientX
        g.y = point.clientY
      }
      if (Math.hypot(g.x - g.originX, g.y - g.originY) >= 5) g.moved = true
      if (g.active) {
        event.preventDefault()
        event.stopPropagation()
        if (frameScheduled) {
          cancelAnimationFrame(frame)
          frameScheduled = false
        }
        // 松手时用最终坐标基于快照重算落点。
        update(false)
      }
      const dayTap = g.active && g.touchId !== null && g.selection.kind === "day" && !g.moved
      finish(!dayTap)
      if (dayTap && latest.current.enabled) latest.current.onSelect(g.selection)
    }
    function cancel() {
      finish(false)
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault()
        cancel()
      }
    }
    function scroll() {
      if (gesture.current && !gesture.current.active) cancel()
    }
    function contextMenu(event: Event) {
      if (gesture.current) event.preventDefault()
    }
    cancelGesture.current = cancel
    document.addEventListener("mousedown", begin, true)
    document.addEventListener("touchstart", begin, { capture: true, passive: true })
    document.addEventListener("mousemove", move, true)
    document.addEventListener("mouseup", end, true)
    document.addEventListener("keydown", key, true)
    document.addEventListener("contextmenu", contextMenu, true)
    document.addEventListener("scroll", scroll, true)
    window.addEventListener("blur", cancel)
    return () => {
      cancel()
      cancelGesture.current = null
      resizeObserver.disconnect()
      document.removeEventListener("mousedown", begin, true)
      document.removeEventListener("touchstart", begin, true)
      document.removeEventListener("mousemove", move, true)
      document.removeEventListener("mouseup", end, true)
      document.removeEventListener("keydown", key, true)
      document.removeEventListener("contextmenu", contextMenu, true)
      document.removeEventListener("scroll", scroll, true)
      window.removeEventListener("blur", cancel)
    }
  }, [props.enabled])

  const markers = useMemo(() => {
    const appliedIds = new Set(props.traces.map((trace) => trace.patchId))
    const coursePatchIds = new Set(
      props.patches
        .filter((patch) => patch.enabled && patch.kind === "course")
        .map((patch) => patch.id)
    )
    const adjustedCourses = new Set<string>()
    for (const course of props.courses) {
      for (const id of course.patchIds) {
        appliedIds.add(id)
      }
      // A later whole-day operation supersedes inherited single-course markers.
      const lastPatchId = course.patchIds.at(-1)
      if (lastPatchId && coursePatchIds.has(lastPatchId)) {
        adjustedCourses.add(course.occurrenceId)
      }
    }
    const adjustedDates = new Set<string>()
    for (const patch of props.patches) {
      if (!patch.enabled || patch.kind !== "day" || !appliedIds.has(patch.id)) continue
      if (patch.mode !== "copy") adjustedDates.add(patch.sourceDate)
      if (patch.mode !== "clear") adjustedDates.add(patch.targetDate)
    }
    return { adjustedDates, adjustedCourses, coursePatchIds }
  }, [props.patches, props.courses, props.traces])

  const value = useMemo<ScheduleEditorValue>(
    () => ({
      enabled: props.enabled,
      editing: props.editing,
      ...markers,
      termStartDate: props.termStartDate,
      courses: props.courses,
      traces: props.traces,
      isDragging: () => gesture.current?.active ?? false,
      selectCourse: (course) => {
        const occurrence = scheduleOccurrence(course)
        if (!latest.current.enabled || !occurrence) return false
        latest.current.onSelect({ kind: "course", date: occurrence.date, courses: [occurrence] })
        return true
      },
      selectDay: (date) => {
        if (!latest.current.enabled) return
        latest.current.onSelect({
          kind: "day",
          date,
          courses: latest.current.courses.filter((c) => c.date === date),
        })
      },
      onTraceClick: props.onTraceClick,
    }),
    [
      props.enabled,
      props.editing,
      props.termStartDate,
      props.courses,
      props.traces,
      props.onTraceClick,
      markers,
    ]
  )

  return (
    <ScheduleEditorContext.Provider value={value}>
      <div
        ref={root}
        className={cn("flex min-h-0 flex-1 flex-col", props.editing && "select-none")}
        data-schedule-editing={props.editing || undefined}
        inert={props.editing && !props.enabled}
      >
        {props.editing && (
          <div className="flex shrink-0 flex-col gap-1 border-b border-border px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("scheduleEditor.previousWeek")}
                disabled={!props.enabled || props.selectedWeek <= 1}
                onClick={() => props.onShiftWeek(-1)}
              >
                <ChevronLeft />
              </Button>
              <span className="text-sm font-medium" aria-live="polite">
                {t("scheduleEditor.viewedWeek", { week: props.selectedWeek })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("scheduleEditor.nextWeek")}
                disabled={!props.enabled || props.selectedWeek >= props.totalWeeks}
                onClick={() => props.onShiftWeek(1)}
              >
                <ChevronRight />
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {t("scheduleEditor.dragHint")}
            </p>
          </div>
        )}
        {props.children}
      </div>
      {active &&
        createPortal(
          <>
            <div
              ref={preview}
              className="pointer-events-none fixed z-50 rounded border-2 border-dashed"
            />
            <div
              ref={overlay}
              className="pointer-events-none fixed top-0 left-0 z-50 flex w-44 flex-col gap-1 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
            >
              <span className="font-medium">
                {active.kind === "day"
                  ? t("scheduleEditor.draggingDay", { count: active.courses.length })
                  : t("scheduleEditor.draggingCourse", { name: active.courses[0].name })}
              </span>
              {edgeDirection !== 0 && (
                <span
                  className="flex items-center gap-1 text-xs font-semibold text-primary"
                  role="status"
                >
                  {edgeDirection < 0 ? (
                    <ChevronLeft className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0" />
                  )}
                  {t(edgeDirection < 0 ? "scheduleEditor.edgePrevious" : "scheduleEditor.edgeNext")}
                </span>
              )}
              <span className="text-xs text-muted-foreground" role="status">
                {targetLabel?.valid
                  ? t("scheduleEditor.dropTarget", {
                      date: targetLabel.date,
                      section: targetLabel.section,
                    })
                  : t("scheduleEditor.invalidDrop")}
              </span>
            </div>
          </>,
          document.body
        )}
    </ScheduleEditorContext.Provider>
  )
}

function ScheduleAdjustmentBadge({ kind }: { kind: SchedulePatch["kind"] }) {
  const { t } = useTranslation()
  const label = t(kind === "day" ? "scheduleEditor.dayAdjusted" : "scheduleEditor.courseAdjusted")
  return (
    <Badge
      variant="secondary"
      className="mr-0.5 h-[11px] rounded-[3px] px-0.5 py-0 align-baseline text-[8px] leading-none"
      title={label}
      aria-label={label}
    >
      {t("scheduleEditor.adjustmentMark")}
    </Badge>
  )
}

export function ScheduleDayLabel({ week, day }: { week: number; day: number }) {
  const editor = useScheduleEditor()
  const { t } = useTranslation()
  const adjusted =
    editor.termStartDate && editor.adjustedDates.has(scheduleDate(editor.termStartDate, week, day))
  return (
    <span className="inline-flex items-center text-[11px]">
      {adjusted && <ScheduleAdjustmentBadge kind="day" />}
      {t(`dashboard.weekdayShort.${day}`)}
    </span>
  )
}

export function ScheduleDayHandle({ week, day }: { week: number; day: number }) {
  const editor = useScheduleEditor()
  const { t } = useTranslation()
  if (!editor.editing || !editor.termStartDate) return null
  const date = scheduleDate(editor.termStartDate, week, day)
  return (
    <button
      type="button"
      data-schedule-day={date}
      disabled={!editor.enabled}
      className="flex min-h-7 w-full touch-none items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring enabled:hover:bg-accent disabled:opacity-50"
      aria-label={t("scheduleEditor.dragDay", { date })}
      onClick={() => editor.selectDay(date)}
    >
      <GripVertical className="size-3.5" />
    </button>
  )
}

export function SchedulePatchedLabel({ course }: { course: Course }) {
  const editor = useScheduleEditor()
  const occurrence = scheduleOccurrence(course)
  if (!occurrence || !editor.adjustedCourses.has(occurrence.occurrenceId)) return null
  return <ScheduleAdjustmentBadge kind="course" />
}

export function ScheduleGridTraces({
  week,
  sectionToRow,
}: {
  week: number
  sectionToRow: Map<number, number>
}) {
  const editor = useScheduleEditor()
  const { t } = useTranslation()
  if (!editor.termStartDate) return null
  const groups = new Map<
    string,
    { day: number; start: number; end: number; traces: ScheduleTrace[] }
  >()
  for (const trace of editor.traces) {
    const position = scheduleWeek(trace.date, editor.termStartDate)
    if (position.week !== week) continue
    const start = sectionToRow.get(trace.startSection),
      end = sectionToRow.get(trace.endSection)
    if (!start || !end) continue
    const key = `${position.weekday}:${start}:${end}`
    const group = groups.get(key)
    if (group) group.traces.push(trace)
    else groups.set(key, { day: position.weekday, start, end, traces: [trace] })
  }
  return Array.from(groups.entries()).map(([key, group]) => {
    const occupied = editor.courses.some((course) =>
      group.traces.some(
        (trace) =>
          course.date === trace.date &&
          course.startSection <= trace.endSection &&
          course.endSection >= trace.startSection
      )
    )
    return (
      <div
        key={key}
        className={cn(
          "pointer-events-none relative z-30 m-0.5 flex flex-col gap-0.5 rounded-md",
          occupied
            ? "justify-end"
            : "justify-center border border-dashed border-muted-foreground/60"
        )}
        style={{ gridColumn: group.day + 1, gridRow: `${group.start} / ${group.end + 1}` }}
      >
        {group.traces.map((trace, index) => (
          <button
            key={`${trace.patchId}:${index}`}
            type="button"
            disabled={editor.editing && !editor.enabled}
            className={cn(
              "pointer-events-auto flex flex-col rounded-sm bg-background/95 px-0.5 py-0.5 text-left text-[9px] leading-tight text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              occupied && "border border-dashed border-muted-foreground/60"
            )}
            title={`${trace.name} · ${t(`scheduleEditor.${trace.kind}`)} · ${trace.targetDate}`}
            onClick={() => editor.onTraceClick(trace.patchId)}
          >
            {!occupied && (
              <span className="line-clamp-3 font-medium">
                {editor.coursePatchIds.has(trace.patchId) && (
                  <ScheduleAdjustmentBadge kind="course" />
                )}
                {trace.name}
              </span>
            )}
            <span className="flex items-start gap-0.5">
              <History className="mt-px size-2.5 shrink-0" />
              <span>
                {trace.kind === "moved"
                  ? t("scheduleEditor.movedTo", {
                      date: occupied ? trace.targetDate.slice(5) : trace.targetDate,
                    })
                  : t(`scheduleEditor.${trace.kind}`)}
              </span>
            </span>
          </button>
        ))}
      </div>
    )
  })
}
