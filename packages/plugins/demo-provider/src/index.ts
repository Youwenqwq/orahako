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
    "shell.banner": { kind: "list"; owner: Record<string, never> }
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
    inject: ["providers", "provider", "session", "slots", "router", "i18n"],
    description: "免账号本地演示数据源，支持模拟登录、MFA、课表、成绩与考试预览",
  },
  inject: ["providers", "provider", "session", "slots", "router", "i18n"] as const,
  apply(ctx) {
    const { providers, provider, session, slots, router, i18n } = ctx
    i18n.register(demoProviderDictionary)

    let restoreSchoolId: string | null = null
    const trackNonDemoSchool = (): void => {
      const current = provider.getSnapshot().schoolId ?? session.getSnapshot().activeSchoolId
      if (current && current !== DEMO_SCHOOL_ID) {
        restoreSchoolId = current
      }
    }
    trackNonDemoSchool()
    const unsubProvider = provider.state.subscribe(trackNonDemoSchool)
    ctx.effect(() => () => unsubProvider())

    const unregister = providers.registerProvider(DEMO_SCHOOL_ID, () => createDemoProvider())
    ctx.effect(() => unregister)

    const exitDemo = async (): Promise<void> => {
      try {
        await provider.logout()
      } finally {
        session.clearCredential(DEMO_SCHOOL_ID)
      }
      const fallbackSchool =
        (restoreSchoolId && providers.hasProvider(restoreSchoolId) ? restoreSchoolId : null) ??
        providers.listProviders().find((id) => id !== DEMO_SCHOOL_ID) ??
        null
      if (fallbackSchool) {
        provider.selectSchool(fallbackSchool)
        void provider.initialize().catch(() => {})
      }
      router.replace({ route: "login" })
    }

    slots.inject("shell.banner", () =>
      slots.register(
        {
          id: "demo-mode-banner",
          slot: "shell.banner",
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
