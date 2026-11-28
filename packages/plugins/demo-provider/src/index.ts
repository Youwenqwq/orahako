import "@orahako/academic-sdk"
import { definePlugin, PLUGIN_API_VERSION } from "@orahako/sdk"
import {
  DemoLoginFooter,
  DemoModeBanner,
  DemoOnboardingEntry,
  demoProviderDictionary,
  type DemoBannerInject,
  type DemoLoginFooterInject,
  type DemoLoginFooterOwner,
  type DemoOnboardingEntryInject,
  type DemoOnboardingEntryOwner,
  type DemoProviderDictionary,
} from "./banner"
import { DEMO_SCHOOL_ID } from "./data"
import { createDemoProvider, DEMO_DEFAULT_PASSWORD, DEMO_DEFAULT_USERNAME } from "./demo-provider"

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.header.actions": { kind: "list"; owner: Record<string, never> }
    "onboarding.school.footer": { kind: "list"; owner: DemoOnboardingEntryOwner }
    "auth.login.footer": { kind: "list"; owner: DemoLoginFooterOwner }
  }
}

export const DEMO_PROVIDER_PLUGIN_ID = "orahako.demo.provider"

export {
  createDemoProvider,
  DEMO_DEFAULT_PASSWORD,
  DEMO_DEFAULT_USERNAME,
  DEMO_SCHOOL_ID,
  DemoLoginFooter,
  DemoModeBanner,
  DemoOnboardingEntry,
  demoProviderDictionary,
  type DemoBannerInject,
  type DemoLoginFooterInject,
  type DemoLoginFooterOwner,
  type DemoOnboardingEntryInject,
  type DemoOnboardingEntryOwner,
  type DemoProviderDictionary,
}

export const demoProviderPlugin = definePlugin({
  manifest: {
    id: DEMO_PROVIDER_PLUGIN_ID,
    name: "演示大学（Demo）",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "provider",
    providerIndependent: true,
    entry: "index.js",
    inject: ["providers", "provider", "session", "slots", "i18n"],
    description: "免账号本地演示数据源，支持模拟登录、MFA、课表、成绩与考试预览",
  },
  inject: ["providers", "provider", "session", "slots", "i18n"] as const,
  apply(ctx) {
    const { providers, provider, session, slots, i18n } = ctx
    i18n.register(demoProviderDictionary)

    let reloading = false
    const reloadApp = (): void => {
      if (reloading) return
      reloading = true
      if (typeof window !== "undefined" && typeof window.location?.reload === "function") {
        setTimeout(() => {
          window.location.reload()
        }, 50)
      }
    }

    const resetAwayFromDemo = (): void => {
      const fallbackSchool = providers.listProviders().find((id) => id !== DEMO_SCHOOL_ID) ?? null
      if (fallbackSchool) {
        provider.selectSchool(fallbackSchool)
      }
    }

    const teardownDemoAndReload = (): void => {
      session.clearCredential(DEMO_SCHOOL_ID)
      session.setSessionExpired(false)
      resetAwayFromDemo()
      reloadApp()
    }

    const unregister = providers.registerProvider(DEMO_SCHOOL_ID, () =>
      createDemoProvider({
        onLogout: teardownDemoAndReload,
      })
    )

    const enterDemoMode = async (): Promise<void> => {
      if (!providers.hasProvider(DEMO_SCHOOL_ID)) {
        throw new Error("Demo provider is not available")
      }
      session.clearCredential(DEMO_SCHOOL_ID)
      session.setSessionExpired(false)
      provider.selectSchool(DEMO_SCHOOL_ID)
      await provider.initialize()
    }

    const exitDemo = async (): Promise<void> => {
      try {
        await provider.logout()
      } finally {
        teardownDemoAndReload()
      }
    }

    ctx.effect(() => () => {
      const wasActiveDemo =
        provider.getSnapshot().schoolId === DEMO_SCHOOL_ID ||
        session.getSnapshot().activeSchoolId === DEMO_SCHOOL_ID
      unregister()
      session.clearCredential(DEMO_SCHOOL_ID)
      if (wasActiveDemo) {
        teardownDemoAndReload()
      }
    })

    slots.inject("onboarding.school.footer", () =>
      slots.register(
        {
          id: "demo-onboarding-entry",
          slot: "onboarding.school.footer",
          order: 10,
          dictionary: demoProviderDictionary,
          inject: (): DemoOnboardingEntryInject => ({
            enterDemoMode,
          }),
        },
        DemoOnboardingEntry
      )
    )

    slots.inject("auth.login.footer", () =>
      slots.register(
        {
          id: "demo-login-footer",
          slot: "auth.login.footer",
          order: 10,
          dictionary: demoProviderDictionary,
          inject: (): DemoLoginFooterInject => ({
            exitDemo,
          }),
        },
        DemoLoginFooter
      )
    )

    slots.inject("shell.header.actions", () =>
      slots.register(
        {
          id: "demo-mode-indicator",
          slot: "shell.header.actions",
          order: -50,
          dictionary: demoProviderDictionary,
          inject: (): DemoBannerInject => ({
            hooks: {
              session: session.state,
              provider: provider.state,
            },
            exitDemo,
          }),
        },
        DemoModeBanner
      )
    )
  },
})

export default demoProviderPlugin
