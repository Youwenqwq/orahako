import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { describe, expect, it, vi } from "vitest"
import policy from "../../harmony/security-policy.json"

type Attribute = boolean | number | Uint8Array
type Attributes = Map<number, Attribute>
interface NativeStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}
interface NativePolicy {
  validate(method: string, input: string, body?: string): void
}

/** Execute the actual ArkTS security classes, substituting only OS APIs. */
function loadNative(name: string, mocks: Record<string, object>): Record<string, unknown> {
  const source = readFileSync(
    new URL(`../../harmony/entry/src/main/ets/security/${name}.ets`, import.meta.url),
    "utf8"
  )
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const exports: Record<string, unknown> = {}
  runInNewContext(compiled, {
    exports,
    Uint8Array,
    ArrayBuffer,
    Map,
    Set,
    Date,
    setTimeout,
    clearTimeout,
    canIUse: () => true,
    require: (id: string) => {
      if (!(id in mocks)) throw new Error(`Unexpected native dependency: ${id}`)
      return mocks[id]
    },
  })
  return exports
}

const util = {
  Base64Helper: class {
    encodeToStringSync(bytes: Uint8Array) {
      // The actual Harmony API rejects empty input; Buffer's encoder does not.
      if (bytes.length === 0) throw Object.assign(new Error("Empty Base64 input"), { code: 401 })
      return Buffer.from(bytes).toString("base64")
    }
  },
  TextEncoder: class {
    encodeInto(input: string) {
      return new TextEncoder().encode(input)
    }
  },
  TextDecoder: {
    create: () => ({ decodeToString: (bytes: Uint8Array) => new TextDecoder().decode(bytes) }),
  },
  generateRandomUUID: randomUUID,
}

class NativeURL extends URL {
  get params() {
    return this.searchParams
  }
}
const nativeUrl = { URL: NativeURL, URLParams: URLSearchParams }

describe("Harmony schedule service card", () => {
  const data = loadNative("../widgets/ScheduleWidgetData", {}) as {
    buildScheduleBinding(
      snapshot: object | null,
      compact: boolean,
      now?: number
    ): {
      heading: string
      summary: string
      emptyText: string
      courses: Array<{ title: string; detail: string; color: string }>
    }
  }
  const first = {
    name: "Math",
    classroom: "A101",
    week_day: 1,
    week_list: [2],
    start_section: 1,
    end_section: 2,
    end_time: "09:40:00",
  }
  const later = { ...first, name: "Physics", start_section: 3, end_section: 4, end_time: "11:40" }
  const snapshot = {
    courses: [later, first],
    week: { date: "2026-09-13", weekday: 7, week: 1, total_weeks: 2 },
    showNextDay: false,
  }

  it("switches weeks at school midnight and hides completed classes", () => {
    const early = data.buildScheduleBinding(snapshot, false, Date.parse("2026-09-13T17:00:00Z"))
    expect(early.summary).toBe("还有 2 节课")
    expect(early.courses).toEqual([
      { title: "Math", detail: "第 1-2 节 · A101", color: "#5988FA" },
      { title: "Physics", detail: "第 3-4 节 · A101", color: "#4FCFA2" },
    ])
    const midClass = data.buildScheduleBinding(snapshot, false, Date.parse("2026-09-14T01:40:00Z"))
    expect(midClass.summary).toBe("还有 1 节课")
    expect(midClass.courses[0]?.title).toBe("Physics")
    const done = data.buildScheduleBinding(snapshot, false, Date.parse("2026-09-14T03:40:00Z"))
    expect(done).toMatchObject({ emptyText: "今日课程已结束", courses: [] })
    const nextTerm = data.buildScheduleBinding(snapshot, false, Date.parse("2026-09-21T00:00:00Z"))
    expect(nextTerm).toMatchObject({ emptyText: "今天没有课程", courses: [] })
  })

  it("matches app week rules and limits courses by widget size", () => {
    const today = { ...snapshot, courses: [later, first, { ...later, name: "Lab", week_list: [] }] }
    const now = Date.parse("2026-09-13T17:00:00Z")
    expect(data.buildScheduleBinding(today, false, now).courses.map((c) => c.title)).toEqual([
      "Math",
      "Physics",
      "Lab",
    ])
    const square = data.buildScheduleBinding(today, true, now)
    expect(square.courses).toHaveLength(2)
    expect(square.summary).toBe("还有 3 节课")
    expect(data.buildScheduleBinding({ ...today, week: null }, false, now).emptyText).toBe(
      "暂未获取教学周信息"
    )
  })

  it("opens, updates and clears both card types without sharing their caches", async () => {
    const saved = new Map<string, string>()
    const openFormManager = vi.fn()
    const updateForm = vi.fn(async () => {})
    const parsedData = loadNative("../widgets/ScheduleWidgetData", {})
    const examData = loadNative("../widgets/ExamWidgetData", {})
    const formInfo = {
      FormDimension: { Dimension_2_2: 2, Dimension_2_4: 3 },
      FormLocation: { DESKTOP: 0, FORM_CENTER: 1, FORM_MANAGER: 2 },
      FormParam: {
        IDENTITY_KEY: "id",
        NAME_KEY: "name",
        DIMENSION_KEY: "size",
        TEMPORARY_KEY: "temporary",
        FORM_LOCATION_KEY: "location",
      },
    }
    const formBindingData = { createFormBindingData: JSON.parse }
    const widget = loadNative("../widgets/ScheduleWidget", {
      "./ScheduleWidgetData": parsedData,
      "./ExamWidgetData": examData,
      "../security/SecureStore": {
        SecureStore: class {
          async get(key: string) {
            return saved.get(key) ?? null
          }
          async set(key: string, raw: string) {
            saved.set(key, raw)
          }
          async remove(key: string) {
            saved.delete(key)
          }
        },
      },
      "@kit.FormKit": {
        formInfo,
        formBindingData,
        formProvider: {
          openFormManager,
          updateForm,
          getPublishedRunningFormInfoById: async (id: string) => ({
            dimension: id === "6" ? 3 : 2,
            formLocation: 0,
            formName: id === "5" || id === "6" ? "exam_notice" : "today_schedule",
          }),
          getPublishedRunningFormInfos: async () => [
            {
              bundleName: "example",
              abilityName: "ScheduleFormAbility",
              formName: "today_schedule",
              formId: "1",
              dimension: 3,
              formLocation: 0,
            },
            {
              bundleName: "example",
              abilityName: "ScheduleFormAbility",
              formName: "other",
              formId: "2",
            },
            {
              bundleName: "example",
              abilityName: "ScheduleFormAbility",
              formName: "today_schedule",
              formId: "3",
              dimension: 2,
              formLocation: 0,
            },
            {
              bundleName: "example",
              abilityName: "ScheduleFormAbility",
              formName: "today_schedule",
              formId: "4",
              dimension: 2,
              formLocation: 2,
            },
            ...[2, 3].map((dimension) => ({
              bundleName: "example",
              abilityName: "ScheduleFormAbility",
              formName: "exam_notice",
              formId: String(dimension + 3),
              dimension,
              formLocation: 0,
            })),
          ],
        },
      },
    })
    const { ScheduleWidgetBridge, refreshPublishedWidgets } = widget as {
      ScheduleWidgetBridge: new (bundleName: string) => {
        openManager(compact: boolean, exam?: boolean): void
        sync(raw: string, exam?: boolean): Promise<void>
        setPreferences(hours: number, showNextDay: boolean): Promise<void>
        clear(): Promise<void>
      }
      refreshPublishedWidgets(bundleName: string): Promise<void>
    }
    const bridge = new ScheduleWidgetBridge("example")
    bridge.openManager(false)
    expect(openFormManager).toHaveBeenCalledWith({
      bundleName: "example",
      abilityName: "ScheduleFormAbility",
      parameters: {
        "ohos.extra.param.key.form_dimension": 3,
        "ohos.extra.param.key.form_name": "today_schedule",
        "ohos.extra.param.key.module_name": "entry",
      },
    })
    bridge.openManager(true)
    expect(openFormManager).toHaveBeenLastCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({ "ohos.extra.param.key.form_dimension": 2 }),
      })
    )
    for (const compact of [true, false]) {
      bridge.openManager(compact, true)
      expect(openFormManager).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({
            "ohos.extra.param.key.form_name": "exam_notice",
            "ohos.extra.param.key.form_dimension": compact ? 2 : 3,
          }),
        })
      )
    }
    const schoolDay = new Date(Date.now() + 8 * 3_600_000)
    const weekday = ((schoolDay.getUTCDay() + 6) % 7) + 1
    const raw = JSON.stringify({
      ...snapshot,
      week: { week: 2, weekday, date: schoolDay.toISOString().slice(0, 10) },
      courses: [{ ...first, week_day: weekday, end_time: undefined }],
    })
    await bridge.sync(raw)
    expect(JSON.parse(saved.get("schedule-widget")!)).toMatchObject(JSON.parse(raw))
    expect(saved.has("exam-widget")).toBe(false)
    expect(updateForm.mock.calls).toEqual([
      ["1", expect.objectContaining({ compact: false })],
      ["3", expect.objectContaining({ compact: true })],
    ])
    updateForm.mockClear()
    const exam = { name: "Physics", start: Date.now() + 3_600_000, location: "A101", seat: "08" }
    await bridge.sync(JSON.stringify({ exams: [exam] }), true)
    expect(updateForm.mock.calls).toEqual([
      [
        "5",
        expect.objectContaining({
          compact: true,
          exams: [expect.objectContaining({ title: "Physics" })],
        }),
      ],
      [
        "6",
        expect.objectContaining({
          compact: false,
          exams: [expect.objectContaining({ place: "A101 · 座位 08" })],
        }),
      ],
    ])
    expect(JSON.parse(saved.get("exam-widget")!)).toMatchObject({ exams: [exam] })

    updateForm.mockClear()
    await refreshPublishedWidgets("example")
    expect(updateForm).toHaveBeenCalledTimes(4)

    const { default: ScheduleFormAbility } = loadNative("../widgets/ScheduleFormAbility", {
      "./ScheduleWidgetData": parsedData,
      "./ExamWidgetData": examData,
      "./ScheduleWidget": widget,
      "@kit.FormKit": { formInfo, formBindingData, FormExtensionAbility: class {} },
    }) as {
      default: new () => {
        onAddForm(want: { parameters: object }): unknown
        onUpdateForm(formId: string): void
      }
    }
    const ability = new ScheduleFormAbility()
    updateForm.mockClear()
    expect(ability.onAddForm({ parameters: { id: "4", size: 2, location: 2 } })).toMatchObject({
      compact: true,
      summary: "还有 4 节课",
      courses: [{ title: "数学分析" }, { title: "高等代数" }],
    })
    expect(
      ability.onAddForm({ parameters: { name: "exam_notice", size: 2, location: 2 } })
    ).toMatchObject({
      compact: true,
      summary: "剩余 3 场",
      exams: [{ title: "高等数学" }],
    })
    expect(ability.onAddForm({ parameters: { id: "3", size: 2, location: 0 } })).toEqual(
      expect.objectContaining({ compact: true, courses: [] })
    )
    await vi.waitFor(() => expect(updateForm).toHaveBeenCalledTimes(1))
    expect(updateForm).toHaveBeenLastCalledWith(
      "3",
      expect.objectContaining({ compact: true, summary: "还有 1 节课" })
    )
    ability.onUpdateForm("3")
    await vi.waitFor(() => expect(updateForm).toHaveBeenCalledTimes(2))

    await bridge.setPreferences(6, true)
    expect(JSON.parse(saved.get("widget-preferences")!)).toEqual({
      syncReminderHours: 6,
      showNextDay: true,
    })
    saved.set(
      "exam-widget",
      JSON.stringify({ exams: [exam], syncedAt: Date.now() - 7 * 3_600_000 })
    )
    updateForm.mockClear()
    ability.onUpdateForm("5")
    await vi.waitFor(() =>
      expect(updateForm).toHaveBeenCalledWith(
        "5",
        expect.objectContaining({
          syncText: expect.stringMatching(/^上次同步 /),
        })
      )
    )

    updateForm.mockClear()
    await bridge.clear()
    expect([...saved.keys()]).toEqual(["widget-preferences"])
    expect(updateForm).toHaveBeenCalledTimes(4)
    expect(updateForm).toHaveBeenCalledWith("3", expect.objectContaining({ courses: [] }))
    expect(updateForm).toHaveBeenCalledWith(
      "5",
      expect.objectContaining({ exams: [], syncText: "" })
    )
  })
})

describe("Harmony exam service card", () => {
  it("orders upcoming exams in school time and honors each layout's item limit", () => {
    const { buildExamBinding } = loadNative("../widgets/ExamWidgetData", {}) as {
      buildExamBinding(
        snapshot: object,
        compact: boolean,
        now: number
      ): {
        exams: Array<{ title: string; time: string; place: string }>
        summary: string
      }
    }
    const now = Date.parse("2026-11-28T03:00:00Z")
    const snapshot = {
      exams: [
        { name: "Unscheduled" },
        { name: "Later", start: now + 2 * 3_600_000 },
        {
          name: "In progress",
          start: now - 3_600_000,
          end: now + 3_600_000,
          location: "A101",
          seat: "09",
        },
        { name: "Completed", start: now - 2 * 3_600_000, end: now - 3_600_000 },
      ],
    }
    const wide = buildExamBinding(snapshot, false, now)
    expect(wide.exams.map((exam) => exam.title)).toEqual(["In progress", "Later", "Unscheduled"])
    expect(buildExamBinding(snapshot, true, now)).toMatchObject({
      summary: "剩余 3 场",
      exams: [{ title: "In progress", time: "11月28日 10:00", place: "A101 · 座位 09" }],
    })
  })
})

describe("Harmony class reminders", () => {
  function setup() {
    const updateLiveView = vi.fn(async (_view: object) => ({ resultCode: 0 }))
    const startLiveView = vi.fn(async (_view: object) => ({ resultCode: 0 }))
    const stopLiveView = vi.fn(async (_view: object) => ({ resultCode: 0 }))
    const entries: { reminderId: number; reminderReq: object }[] = []
    const publishReminder = vi.fn(async (reminderReq: object) => {
      const reminderId = entries.length + 1
      entries.push({ reminderId, reminderReq })
      return reminderId
    })
    const cancelReminder = vi.fn(async (id: number) => {
      const index = entries.findIndex((entry) => entry.reminderId === id)
      if (index !== -1) entries.splice(index, 1)
    })
    const { classReminders } = loadNative("../reminders/ClassReminders", {
      "@kit.BackgroundTasksKit": {
        reminderAgentManager: {
          ReminderType: { REMINDER_TYPE_CALENDAR: 1 },
          TimeZoneType: { FIXED_TIME_ZONE: 1 },
          getAllValidReminders: async () => [...entries],
          publishReminder,
          cancelReminder,
        },
      },
      "@kit.NotificationKit": { notificationManager: { SlotType: { SERVICE_INFORMATION: 3 } } },
      "@kit.LiveViewKit": {
        liveViewManager: {
          isLiveViewEnabled: async () => true,
          LifeCycleMode: { AUTO_STOP_WHEN_APP_TERMINATE: 1 },
          LayoutType: { LAYOUT_TYPE_PROGRESS: 3 },
          CapsuleType: { CAPSULE_TYPE_TEXT: 1, CAPSULE_TYPE_TIMER: 2 },
          startLiveView,
          updateLiveView,
          stopLiveView,
        },
      },
    }) as {
      classReminders: {
        sync(
          context: object,
          alarms: object[],
          liveView: boolean,
          vibration: boolean
        ): Promise<{
          scheduled: number
          errorCode: number
          liveErrorCode: number
        }>
        cancel(): Promise<void>
      }
    }
    const context = { abilityInfo: { bundleName: "example", name: "EntryAbility" } }
    return {
      classReminders,
      context,
      startLiveView,
      updateLiveView,
      stopLiveView,
      publishReminder,
      cancelReminder,
    }
  }

  it("uses the native course scene for countdown, progress, and the next class", async () => {
    vi.useFakeTimers()
    try {
      const now = Date.parse("2026-09-07T09:45:00+08:00")
      vi.setSystemTime(now)
      const minute = 60_000
      const { classReminders, context, startLiveView, updateLiveView, stopLiveView } = setup()
      await classReminders.sync(
        context,
        [
          {
            alarmTime: now,
            startsAt: now + 15 * minute,
            endsAt: now + 60 * minute,
            courseName: "Math",
            classroom: "A101",
            startTime: "10:00",
          },
          {
            alarmTime: now + 70 * minute,
            startsAt: now + 85 * minute,
            endsAt: now + 130 * minute,
            courseName: "Physics",
            classroom: "B201",
            startTime: "11:10",
          },
        ],
        true,
        true
      )
      expect(startLiveView).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "SCHEDULE",
          timer: { time: 15 * minute, isCountdown: true },
        })
      )
      await vi.advanceTimersByTimeAsync(15 * minute)
      expect(updateLiveView).toHaveBeenLastCalledWith(
        expect.objectContaining({
          timer: { time: 45 * minute, isCountdown: true },
        })
      )
      await vi.advanceTimersByTimeAsync(45 * minute)
      expect(updateLiveView).toHaveBeenLastCalledWith(
        expect.objectContaining({
          liveViewData: expect.objectContaining({
            primary: expect.objectContaining({ title: "Physics" }),
          }),
          timer: { time: 25 * minute, isCountdown: true },
        })
      )
      await classReminders.cancel()
      expect(stopLiveView).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("reuses unchanged system reminders and reports unavailable Live View rights separately", async () => {
    const now = Date.now()
    const { classReminders, context, publishReminder, cancelReminder, startLiveView } = setup()
    const future = {
      alarmTime: now + 60_000,
      startsAt: now + 120_000,
      endsAt: now + 180_000,
      courseName: "Math",
      classroom: "A101",
      startTime: "10:00",
    }
    const ongoing = { ...future, alarmTime: now - 120_000, startsAt: now - 60_000 }
    startLiveView.mockRejectedValue(
      Object.assign(new Error("No Live View rights"), { code: 1003500005 })
    )
    await expect(
      classReminders.sync(context, [future, ongoing], true, true)
    ).resolves.toMatchObject({
      scheduled: 1,
      errorCode: 0,
      liveErrorCode: 1003500005,
    })
    await classReminders.sync(context, [future], false, true)
    expect(publishReminder).toHaveBeenCalledOnce()
    expect(publishReminder).toHaveBeenCalledWith(expect.objectContaining({ ringDuration: 3 }))
    await classReminders.cancel()
    expect(cancelReminder).toHaveBeenCalledOnce()
  })
})

describe("native immersive window appearance", () => {
  function appearance() {
    return loadNative("../WindowAppearance", {
      "@kit.ArkUI": {
        window: {
          AvoidAreaType: { TYPE_SYSTEM: 0, TYPE_CUTOUT: 1, TYPE_NAVIGATION_INDICATOR: 4 },
        },
      },
    }) as {
      readWindowSafeArea(window: object): {
        top: number
        right: number
        bottom: number
        left: number
      }
      applyWindowTheme(window: object, dark: boolean): Promise<void>
    }
  }

  it("merges overlapping system areas without counting the keyboard and rereads after rotation", () => {
    const area = (top = 0, right = 0, bottom = 0, left = 0) => ({
      topRect: { height: top },
      rightRect: { width: right },
      bottomRect: { height: bottom },
      leftRect: { width: left },
    })
    const areas = new Map([
      [0, area(100, 0, 70)],
      [1, area(120, 0, 0, 50)],
      [4, area(0, 0, 90)],
    ])
    const mainWindow = {
      getWindowAvoidArea(type: number) {
        const result = areas.get(type)
        if (!result) throw new Error("Unexpected area (including keyboard)")
        return result
      },
    }
    const { readWindowSafeArea } = appearance()
    expect(readWindowSafeArea(mainWindow)).toEqual({ top: 120, right: 0, bottom: 90, left: 50 })
    areas.set(0, area(0, 0, 0, 100))
    areas.set(1, area(0, 0, 0, 120))
    areas.set(4, area(0, 90))
    expect(readWindowSafeArea(mainWindow)).toEqual({ top: 0, right: 90, bottom: 0, left: 120 })
  })

  it("keeps system backgrounds transparent in both themes and changes icon contrast", async () => {
    const setWindowSystemBarProperties = vi.fn(async () => {})
    const { applyWindowTheme } = appearance()
    await applyWindowTheme({ setWindowSystemBarProperties }, false)
    await applyWindowTheme({ setWindowSystemBarProperties }, true)
    for (const [index, foreground] of ["#000000", "#ffffff"].entries()) {
      expect(setWindowSystemBarProperties.mock.calls[index]).toEqual([
        expect.objectContaining({
          statusBarColor: "#00000000",
          navigationBarColor: "#00000000",
          statusBarContentColor: foreground,
          navigationBarContentColor: foreground,
        }),
      ])
    }
  })
})

describe("actual ArkTS bundled resource policy", () => {
  const resolvePath = loadNative("ResourcePolicy", {}).localResourcePath as (
    input: string,
    origin: string
  ) => string
  const origin = "https://ysu.local"

  it.each(["0ev0vbebrwic..js", "0rhdvkc8cgmk..js", "0.bdlgergfh74.js"])(
    "serves valid Turbopack filenames containing dots: %s",
    (filename) => {
      expect(resolvePath(`${origin}/_next/static/chunks/${filename}`, origin)).toBe(
        `www/_next/static/chunks/${filename}`
      )
    }
  )

  it("resolves packaged page routes and strips query strings", () => {
    expect(resolvePath(`${origin}/login/?source=app#top`, origin)).toBe("www/login/index.html")
    expect(resolvePath(`${origin}/`, origin)).toBe("www/index.html")
  })

  it.each([
    "https://evil.example/login/",
    "https://ysu.local.evil.example/login/",
    `${origin}/../security-policy.json`,
    `${origin}/_next/../../security-policy.json`,
    `${origin}/./index.html`,
    `${origin}/%2e%2e/security-policy.json`,
    `${origin}/_next%2fsecret.js`,
    `${origin}/_next\\secret.js`,
    `${origin}//index.html`,
  ])("rejects external resources and directory traversal: %s", (input) => {
    expect(() => resolvePath(input, origin)).toThrow()
  })
})

function storeFixture() {
  const records = new Map<string, Attributes>()
  const tag = {
    ALIAS: 1,
    SECRET: 2,
    RETURN_TYPE: 3,
    ACCESSIBILITY: 4,
    SYNC_TYPE: 5,
    IS_PERSISTENT: 6,
    CONFLICT_RESOLUTION: 7,
  }
  const alias = (data: Attributes) => new TextDecoder().decode(data.get(tag.ALIAS) as Uint8Array)
  let failManifest = false
  const asset = {
    Tag: tag,
    ReturnType: { ALL: 0 },
    ErrorCode: { NOT_FOUND: 24000002 },
    Accessibility: { DEVICE_UNLOCKED: 2 },
    SyncType: { NEVER: 0 },
    ConflictResolution: { OVERWRITE: 0 },
    async add(data: Attributes) {
      const key = alias(data)
      if (data.has(tag.IS_PERSISTENT)) throw new Error("Unnecessary persistent-data permission")
      const secret = data.get(tag.SECRET) as Uint8Array
      if (secret.length < 1 || secret.length > 1024) throw new Error("Invalid asset size")
      if (failManifest && key.endsWith(".manifest")) throw new Error("Device locked")
      records.set(key, new Map(data))
    },
    async query(data: Attributes) {
      const record = records.get(alias(data))
      if (!record) throw { code: 24000002 }
      return [new Map(record)]
    },
    async remove(data: Attributes) {
      records.delete(alias(data))
    },
  }
  const Store = loadNative("SecureStore", {
    "@kit.AssetStoreKit": { asset },
    "@kit.ArkTS": { util, url: nativeUrl },
  }).SecureStore as new () => NativeStore
  return {
    store: new Store(),
    records,
    tag,
    lockManifest: () => {
      failManifest = true
    },
  }
}

describe("native Asset Store implementation", () => {
  it("roundtrips large Unicode sessions using only device-local encrypted asset chunks", async () => {
    const { store, records, tag } = storeFixture()
    const data = JSON.stringify({ token: "测试会话".repeat(1000) })
    await store.set("academic-client-auth", data)
    expect(await store.get("academic-client-auth")).toBe(data)
    expect(records.size).toBeGreaterThan(2)
    for (const record of records.values()) {
      expect(record.get(tag.ACCESSIBILITY)).toBe(2)
      expect(record.get(tag.SYNC_TYPE)).toBe(0)
      expect(record.has(tag.IS_PERSISTENT)).toBe(false)
    }
    await store.set("academic-client-auth", "")
    expect(await store.get("academic-client-auth")).toBe("")
  })

  it("retains the previous encrypted version if a replacement cannot commit", async () => {
    const { store, lockManifest } = storeFixture()
    await store.set("academic-client-auth", "old-session")
    lockManifest()
    await expect(store.set("academic-client-auth", "new-session".repeat(300))).rejects.toThrow()
    expect(await store.get("academic-client-auth")).toBe("old-session")
  })

  it("serializes reads, writes and logout removal without torn or revived snapshots", async () => {
    const { store, records } = storeFixture()
    const writing = store.set("academic-client-auth", "new-session".repeat(300))
    const reading = store.get("academic-client-auth")
    const removing = store.remove("academic-client-auth")
    await writing
    expect(await reading).toBe("new-session".repeat(300))
    await removing
    expect(await store.get("academic-client-auth")).toBeNull()
    expect(records.size).toBe(0)
  })
})

describe("actual ArkTS request policy", () => {
  it("enforces the packaged policy independently of the page-side checks", () => {
    const Policy = loadNative("RequestPolicy", {
      "@kit.ArkTS": { util, url: nativeUrl },
    }).RequestPolicy as new (manager: object) => NativePolicy
    const native = new Policy({
      getRawFileContentSync: () => new TextEncoder().encode(JSON.stringify(policy)),
    })
    expect(() =>
      native.validate("POST", "https://jwxt.ysu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do")
    ).not.toThrow()
    const mfaPage = "https://cer.ysu.edu.cn/authserver/reAuthCheck/reAuthLoginView.do"
    const callback = encodeURIComponent(
      "https://cer.ysu.edu.cn/personalInfo/personCenter/index.html"
    )
    expect(() => native.validate("GET", `${mfaPage}?service=${callback}`)).not.toThrow()
    expect(() => native.validate("POST", mfaPage)).toThrow()
    for (const route of policy.routes.filter((item) => item.origin === "https://ldxt.ysu.edu.cn")) {
      expect(() => native.validate(route.method, `${route.origin}${route.path}`)).not.toThrow()
    }
    expect(() => native.validate("GET", "https://ldxt.ysu.edu.cn/")).not.toThrow()
    expect(() => native.validate("POST", "https://ldxt.ysu.edu.cn/")).toThrow()
    expect(() => native.validate("GET", `${mfaPage}?service=https://evil.example`)).toThrow()
    for (const url of [
      "https://ysu.welain.com/api/proxy",
      "https://jwxt.ysu.edu.cn/jwmobile/biz/v410/signin/delete",
      "http://jwxt.ysu.edu.cn/authserver/login",
      "https://jwxt.ysu.edu.cn/jwapp/sys/bkbl/modules/bkbm/xgksrwxs.do",
    ]) {
      expect(() => native.validate("POST", url)).toThrow()
    }
    for (const route of policy.routes.filter((item) => item.path.startsWith("/jwmobile/"))) {
      expect(() => native.validate(route.method, `${route.origin}${route.path}`)).not.toThrow()
      expect(() =>
        native.validate(route.method === "GET" ? "POST" : "GET", `${route.origin}${route.path}`)
      ).toThrow()
    }
    for (const route of policy.skbirdRoutes) {
      expect(() => native.validate(route.method, `${route.origin}${route.path}`)).not.toThrow()
    }
    for (const target of [
      "http://api.app.zanao.com/thread/hot",
      "https://b1.cdn.zanao.com/upload/image.jpg@!common",
      "https://thirdwx.qlogo.cn/mmopen/avatar/132",
    ]) {
      expect(() => native.validate("GET", target)).not.toThrow()
      expect(() =>
        native.validate("GET", `${mfaPage}?service=${encodeURIComponent(target)}`)
      ).toThrow()
    }
    expect(() => native.validate("GET", "http://api.app.zanao.com/thread/delete")).toThrow()
    expect(() => native.validate("POST", "https://b1.cdn.zanao.com/upload/image.jpg")).toThrow()
    expect(() =>
      native.validate("GET", "https://cer.ysu.edu.cn/authserver/login?service=https://evil.example")
    ).toThrow()
  })
})

describe("actual ArkTS network bridge", () => {
  it.each([302, 204])(
    "preserves an empty HTTP %i response without passing it to Base64",
    (status) => {
      const Bridge = loadNative("../bridge/NativeBridge", {
        "@kit.ArkTS": { util, url: nativeUrl },
        "../security/RequestPolicy": { RequestPolicy: class {} },
        "../security/SecureStore": { SecureStore: class {} },
        "@kit.RemoteCommunicationKit": { rcp: {} },
      }).NativeBridge as new (controller: object) => {
        encodeResponse(response: object): { status: number; headers: object; bodyBase64: string }
      }
      const bridge = new Bridge({})
      for (const body of [undefined, new ArrayBuffer(0)]) {
        expect(
          bridge.encodeResponse({ statusCode: status, headers: { location: "/next" }, body })
        ).toEqual({
          status,
          headers: { location: "/next" },
          bodyBase64: "",
        })
      }
    }
  )

  it("reports network and storage failures separately without exposing native error details", async () => {
    const sensitive = "https://example.invalid/?password=must-never-appear"
    const replies: Array<{ ok: boolean; error: string }> = []
    const Bridge = loadNative("../bridge/NativeBridge", {
      "@kit.ArkTS": { util, url: nativeUrl },
      "../security/RequestPolicy": {
        RequestPolicy: class {
          validate() {}
        },
      },
      "../security/SecureStore": {
        SecureStore: class {
          async get() {
            throw new Error(sensitive)
          }
        },
      },
      "@kit.RemoteCommunicationKit": {
        rcp: {
          Request: class {},
          createSession: () => ({
            async fetch() {
              throw Object.assign(new Error(sensitive), { code: 1007900006 })
            },
            close() {},
          }),
        },
      },
    }).NativeBridge as new (controller: object) => {
      initialize(manager: object): void
      postMessage(raw: string): void
    }
    const bridge = new Bridge({
      getUrl: () => "https://ysu.local/login/",
      runJavaScript: async (script: string) => {
        replies.push(JSON.parse(script.slice(script.indexOf("(") + 1, -1)))
      },
    })
    bridge.initialize({})
    bridge.postMessage(
      JSON.stringify({
        id: "h101",
        method: "http.request",
        params: { method: "GET", url: "https://cer.ysu.edu.cn/authserver/login" },
      })
    )
    await vi.waitFor(() => expect(replies).toHaveLength(1))
    expect(replies[0]).toMatchObject({ ok: false })
    expect(replies[0].error).toContain("网络连接失败")
    expect(replies[0].error).toContain("1007900006")
    bridge.postMessage(
      JSON.stringify({
        id: "h102",
        method: "secure.get",
        params: { key: "academic-client-auth" },
      })
    )
    await vi.waitFor(() => expect(replies).toHaveLength(2))
    expect(replies[1].error).toContain("安全存储读取失败")
    expect(JSON.stringify(replies)).not.toContain("must-never-appear")
    expect(JSON.stringify(replies)).not.toContain("example.invalid")
  })

  it("blocks foreign pages and unreviewed calls, and forces direct single-hop native requests", async () => {
    interface SessionOptions {
      requestConfiguration: { proxy: string; transfer: { autoRedirect: boolean } }
    }
    interface CapturedRequest {
      url: string
      method: string
      headers: Record<string, string>
      body?: string
    }
    const sent: CapturedRequest[] = []
    const replies: string[] = []
    const options: SessionOptions[] = []
    const savedSecrets: Array<[string, string]> = []
    const closed = vi.fn()
    const Policy = loadNative("RequestPolicy", {
      "@kit.ArkTS": { util, url: nativeUrl },
    }).RequestPolicy
    const Bridge = loadNative("../bridge/NativeBridge", {
      "@kit.ArkTS": { util, url: nativeUrl },
      "../security/RequestPolicy": { RequestPolicy: Policy },
      "../security/SecureStore": {
        SecureStore: class {
          async set(key: string, value: string) {
            savedSecrets.push([key, value])
          }
        },
      },
      "@kit.RemoteCommunicationKit": {
        rcp: {
          Request: class {
            constructor(
              public url: string,
              public method: string,
              public headers: Record<string, string>,
              public body?: string
            ) {}
          },
          createSession(configuration: SessionOptions) {
            options.push(configuration)
            return {
              async fetch(request: CapturedRequest) {
                sent.push(request)
                return {
                  statusCode: 302,
                  headers: { location: "/authserver/index.do" },
                  body: new ArrayBuffer(0),
                }
              },
              close: closed,
            }
          },
        },
      },
    }).NativeBridge as new (controller: object) => {
      initialize(manager: object): void
      postMessage(raw: string): void
    }
    let origin = "https://evil.example/"
    const bridge = new Bridge({
      getUrl: () => origin,
      runJavaScript: async (source: string) => {
        replies.push(source)
      },
    })
    bridge.initialize({
      getRawFileContentSync: () => new TextEncoder().encode(JSON.stringify(policy)),
    })
    const message = (id: string, url: string, headers: Record<string, string> = {}) =>
      JSON.stringify({ id, method: "http.request", params: { method: "GET", url, headers } })
    bridge.postMessage(message("h1", "https://cer.ysu.edu.cn/authserver/login"))
    expect(sent).toHaveLength(0)
    expect(replies).toHaveLength(0)
    origin = "https://ysu.local/login/"
    bridge.postMessage(message("h2", "https://ysu.welain.com/api/proxy?secret=never-echo-this"))
    await vi.waitFor(() => expect(replies).toHaveLength(1))
    expect(sent).toHaveLength(0)
    expect(replies[0]).not.toContain("never-echo-this")
    bridge.postMessage(message("h3", "https://cer.ysu.edu.cn/authserver/login"))
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(options[0].requestConfiguration.proxy).toBe("no-proxy")
    expect(options[0].requestConfiguration.transfer.autoRedirect).toBe(false)
    await vi.waitFor(() => expect(replies).toHaveLength(2))
    expect(replies[1]).toContain('"ok":true')
    expect(replies[1]).toContain('"status":302')
    expect(replies[1]).toContain('"bodyBase64":""')
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
    const communityHeaders = {
      "x-sc-token": "community-token",
      "x-sc-ah": "signature",
      "x-sc-device": "device",
      "x-sc-td": "timestamp",
      "x-sc-nd": "nonce",
    }
    bridge.postMessage(
      message("h4", "http://api.app.zanao.com/thread/hot", {
        ...communityHeaders,
        cookie: "CASTGC=school",
        referer: "https://cer.ysu.edu.cn/",
      })
    )
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1].headers).toEqual(communityHeaders)
    bridge.postMessage(
      message("h5", "https://b1.cdn.zanao.com/upload/image.jpg@!common", {
        ...communityHeaders,
        cookie: "CASTGC=school",
      })
    )
    await vi.waitFor(() => expect(sent).toHaveLength(3))
    expect(sent[2].headers).toEqual({})
    bridge.postMessage(
      message("h6", "https://cer.ysu.edu.cn/authserver/login", {
        ...communityHeaders,
        cookie: "CASTGC=school",
      })
    )
    await vi.waitFor(() => expect(sent).toHaveLength(4))
    expect(sent[3].headers).toEqual({ cookie: "CASTGC=school" })
    bridge.postMessage(
      JSON.stringify({
        id: "h7",
        method: "secure.set",
        params: { key: "academic-client-skbird", value: "encrypted-by-asset-store" },
      })
    )
    await vi.waitFor(() =>
      expect(savedSecrets).toEqual([["academic-client-skbird", "encrypted-by-asset-store"]])
    )
  })
})
