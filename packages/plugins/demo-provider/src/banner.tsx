import { FlaskConical, LogOut } from "lucide-react"
import type { ProviderRuntimeSnapshot, SessionSnapshot } from "@orahako/academic-sdk"
import {
  defineDictionary,
  type DerivedComponentProps,
  type ObservableSource,
  type SlotComponent,
} from "@orahako/sdk"
import { Button } from "@orahako/ui-primitives"
import { DEMO_SCHOOL_ID } from "./data"

export const demoProviderDictionary = defineDictionary({
  zh: {
    bannerTitle: "当前处于演示模式",
    bannerDesc: "所有课表、成绩与考试均为本地示例数据，不会连接真实教务系统。",
    exitDemo: "退出演示",
  },
  en: {
    bannerTitle: "Demo mode active",
    bannerDesc: "All schedule, grade, and exam data are local samples.",
    exitDemo: "Exit demo",
  },
})

export type DemoProviderDictionary = typeof demoProviderDictionary

export interface DemoBannerInject {
  readonly hooks: {
    readonly session: ObservableSource<SessionSnapshot>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
  readonly exitDemo: () => Promise<void>
}

export type DemoBannerProps = DerivedComponentProps<
  Record<string, never>,
  DemoProviderDictionary,
  undefined,
  undefined,
  DemoBannerInject
>

export const DemoModeBanner: SlotComponent<DemoBannerProps> = (props) => {
  const { t, exitDemo } = props
  const session = props.useSession()
  const provider = props.useProvider()

  const activeSchoolId = provider.schoolId ?? session.activeSchoolId
  if (!session.isAuthenticated || activeSchoolId !== DEMO_SCHOOL_ID) {
    return null
  }

  return (
    <div
      role="status"
      data-demo-banner=""
      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs text-foreground"
    >
      <div className="flex min-w-0 items-center gap-2">
        <FlaskConical className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="font-medium">{t("bannerTitle")}</span>
        <span className="hidden text-muted-foreground sm:inline">· {t("bannerDesc")}</span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 text-xs"
        onClick={() => void exitDemo()}
      >
        <LogOut className="size-3.5" />
        {t("exitDemo")}
      </Button>
    </div>
  )
}
