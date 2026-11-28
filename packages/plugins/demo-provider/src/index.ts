import "@orahako/academic-sdk"
import { definePlugin, PLUGIN_API_VERSION } from "@orahako/sdk"
import {
  DemoModeBanner,
  demoProviderDictionary,
  type DemoBannerInject,
  type DemoProviderDictionary,
} from "./banner"
import { DEMO_SCHOOL_ID } from "./data"
import { createDemoProvider, DEMO_DEFAULT_PASSWORD, DEMO_DEFAULT_USERNAME } from "./demo-provider"

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.header.actions": { kind: "list"; owner: Record<string, never> }
  }
}

export const DEMO_PROVIDER_PLUGIN_ID = "orahako.demo.provider"

export {
  createDemoProvider,
  DEMO_DEFAULT_PASSWORD,
  DEMO_DEFAULT_USERNAME,
  DEMO_SCHOOL_ID,
  DemoModeBanner,
  demoProviderDictionary,
  type DemoBannerInject,
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

    const unregister = providers.registerProvider(DEMO_SCHOOL_ID, () => createDemoProvider())

    const reloadApp = (): void => {
      if (typeof window !== "undefined" && typeof window.location?.reload === "function") {
        setTimeout(() => {
          window.location.reload()
        }, 50)
      }
    }

    const resetAwayFromDemo = (): void => {
      const fallbackSchool =
        providers.listProviders().find((id) => id !== DEMO_SCHOOL_ID) ?? null
      if (fallbackSchool) {
        provider.selectSchool(fallbackSchool)
      }
    }

    const exitDemo = async (): Promise<void> => {
      try {
        await provider.logout()
      } finally {
        session.clearCredential(DEMO_SCHOOL_ID)
        session.setSessionExpired(false)
      }
      resetAwayFromDemo()
      reloadApp()
    }

    ctx.effect(() => () => {
      const wasActiveDemo =
        provider.getSnapshot().schoolId === DEMO_SCHOOL_ID ||
        session.getSnapshot().activeSchoolId === DEMO_SCHOOL_ID
      unregister()
      session.clearCredential(DEMO_SCHOOL_ID)
      if (wasActiveDemo) {
        session.setSessionExpired(false)
        resetAwayFromDemo()
        reloadApp()
      }
    })

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
