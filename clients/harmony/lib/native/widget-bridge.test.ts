import { describe, expect, it, vi } from "vitest"
import type { Course } from "@/providers/types"
import { harmonyCall } from "./harmony"
import { syncExamsToWidget, syncScheduleToWidget } from "./widget-bridge"

vi.mock("./harmony", () => ({ isHarmony: () => true, harmonyCall: vi.fn() }))
vi.mock("@/lib/stores/auth", () => ({
  useAuthStore: { getState: () => ({ isAuthenticated: true }) },
}))

describe("Harmony widget schedule sync", () => {
  it("compacts a full term of occurrences while preserving moved classes", async () => {
    const weeks = Array.from({ length: 18 }, (_, index) => index + 1)
    const courses: Course[] = Array.from({ length: 30 }, (_, index) => index).flatMap((index) =>
      weeks.map((week) => ({
        name: `Course ${index}`,
        classroom: index === 0 && week === 6 ? "B203" : "A101",
        weekDay: 1,
        weekList: [week],
        startSection: 1,
        endSection: 2,
      }))
    )

    await syncScheduleToWidget(courses, null, [])

    const [method, params] = vi.mocked(harmonyCall).mock.calls[0]
    expect(method).toBe("scheduleWidget.sync")
    const payload = JSON.parse((params as { scheduleSnapshot: string }).scheduleSnapshot)
    expect(payload.courses).toHaveLength(31)
    expect(
      payload.courses.filter((course: { name: string }) => course.name === "Course 0")
    ).toEqual([
      expect.objectContaining({ classroom: "A101", week_list: weeks.filter((week) => week !== 6) }),
      expect.objectContaining({ classroom: "B203", week_list: [6] }),
    ])
  })
})

describe("Harmony widget exam sync", () => {
  it("serializes school-local times and preserves seat details and empty results", async () => {
    await syncExamsToWidget([
      {
        name: "Math",
        startAt: "2026-11-28T09:00:00",
        endAt: "2026-11-28T11:00:00",
        examLocation: "A101",
        seatNumber: "08",
      },
      { name: "Old exam", status: "completed" },
      { name: "English", timeText: "待通知" },
    ])
    expect(harmonyCall).toHaveBeenLastCalledWith("examWidget.sync", {
      examSnapshot: JSON.stringify({
        exams: [
          {
            name: "Math",
            start: Date.parse("2026-11-28T01:00:00Z"),
            end: Date.parse("2026-11-28T03:00:00Z"),
            location: "A101",
            seat: "08",
          },
          { name: "English", timeText: "待通知" },
        ],
      }),
    })

    await syncExamsToWidget([])
    expect(harmonyCall).toHaveBeenLastCalledWith("examWidget.sync", {
      examSnapshot: '{"exams":[]}',
    })
  })
})
