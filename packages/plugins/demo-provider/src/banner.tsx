import { useState } from "react"
import { FlaskConical, LogOut } from "lucide-react"
import type { ProviderRuntimeSnapshot, SessionSnapshot } from "@orahako/academic-sdk"
import {
  defineDictionary,
  type DerivedComponentProps,
  type ObservableSource,
  type SlotComponent,
} from "@orahako/sdk"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
} from "@orahako/ui-primitives"
import { DEMO_SCHOOL_ID } from "./data"

export const demoProviderDictionary = defineDictionary({
  zh: {
    tryDemo: "想先试试看？体验演示模式",
    tryDemoFailed: "演示模式启动失败，请重试",
    loginHint: "演示模式：任意学号密码可登录，密码输 mfa 可体验二次验证",
    exitDemoMode: "退出演示模式",
    indicatorLabel: "演示模式",
    bannerTitle: "当前处于演示模式",
    bannerDesc: "所有课表、成绩与考试均为本地示例数据，不会连接真实教务系统。是否退出演示模式？",
    stayInDemo: "继续体验",
    exitDemo: "退出演示",
  },
  en: {
    tryDemo: "Just exploring? Try Demo Mode",
    tryDemoFailed: "Could not start demo mode. Try again.",
    loginHint: 'Demo mode: sign in with any credentials, or use password "mfa" to test 2FA',
    exitDemoMode: "Exit demo mode",
    indicatorLabel: "Demo",
    bannerTitle: "Demo mode active",
    bannerDesc:
      "All schedule, grade, and exam data are local samples and do not connect to a real school system. Exit demo mode?",
    stayInDemo: "Stay in demo",
    exitDemo: "Exit demo",
  },
})

export type DemoProviderDictionary = typeof demoProviderDictionary

export interface DemoOnboardingEntryOwner {
  readonly disabled: boolean
  readonly dismissWithHandoff: (action: () => Promise<void> | void) => Promise<void>
}

export interface DemoOnboardingEntryInject {
  readonly enterDemoMode: () => Promise<void>
}

export type DemoOnboardingEntryProps = DerivedComponentProps<
  DemoOnboardingEntryOwner,
  DemoProviderDictionary,
  undefined,
  undefined,
  DemoOnboardingEntryInject
>

export const DemoOnboardingEntry: SlotComponent<DemoOnboardingEntryProps> = (props) => {
  const { t, disabled, dismissWithHandoff, enterDemoMode } = props
  const [entering, setEntering] = useState(false)
  const [failed, setFailed] = useState(false)

  const handleClick = async () => {
    if (entering || disabled) return
    setEntering(true)
    setFailed(false)
    try {
      await dismissWithHandoff(enterDemoMode)
    } catch {
      setFailed(true)
    } finally {
      setEntering(false)
    }
  }

  return (
    <div className="mt-3 flex flex-col items-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-onboarding-try-demo=""
        disabled={disabled || entering}
        onClick={() => void handleClick()}
        className="h-9 w-full rounded-xl text-muted-foreground hover:text-foreground"
      >
        {entering && <Spinner data-icon="inline-start" />}
        {t("tryDemo")}
      </Button>
      {failed && (
        <p role="alert" className="text-xs text-destructive">
          {t("tryDemoFailed")}
        </p>
      )}
    </div>
  )
}

export interface DemoLoginFooterOwner {
  readonly schoolId: string | null
  readonly disabled: boolean
}

export interface DemoLoginFooterInject {
  readonly exitDemo: () => Promise<void>
}

export type DemoLoginFooterProps = DerivedComponentProps<
  DemoLoginFooterOwner,
  DemoProviderDictionary,
  undefined,
  undefined,
  DemoLoginFooterInject
>

export const DemoLoginFooter: SlotComponent<DemoLoginFooterProps> = (props) => {
  const { t, schoolId, disabled, exitDemo } = props
  if (schoolId !== DEMO_SCHOOL_ID) return null

  return (
    <div data-login-demo-notice="" className="flex flex-col items-center gap-2 pt-1 text-center">
      <p className="text-xs leading-relaxed text-muted-foreground">{t("loginHint")}</p>
      <button
        type="button"
        data-login-exit-demo=""
        disabled={disabled}
        onClick={() => void exitDemo()}
        className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        {t("exitDemoMode")}
      </button>
    </div>
  )
}

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
  const [open, setOpen] = useState(false)
  const [exiting, setExiting] = useState(false)

  const activeSchoolId = provider.schoolId ?? session.activeSchoolId
  if (!session.isAuthenticated || activeSchoolId !== DEMO_SCHOOL_ID) {
    return null
  }

  const handleConfirmExit = async () => {
    if (exiting) return
    setExiting(true)
    try {
      await exitDemo()
      setOpen(false)
    } finally {
      setExiting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        data-demo-indicator=""
        onClick={() => setOpen(true)}
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/70 bg-muted/60 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <FlaskConical className="size-3.5 text-amber-600 dark:text-amber-400" />
        <span>{t("indicatorLabel")}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="size-4 text-amber-600 dark:text-amber-400" />
              <span>{t("bannerTitle")}</span>
            </DialogTitle>
            <DialogDescription>{t("bannerDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={exiting}
              onClick={() => setOpen(false)}
            >
              {t("stayInDemo")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={exiting}
              onClick={() => void handleConfirmExit()}
            >
              <LogOut className="mr-1.5 size-3.5" />
              {t("exitDemo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
