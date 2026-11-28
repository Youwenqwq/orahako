import "@orahako/sdk"

export interface AuthLoginFooterOwner {
  readonly schoolId: string | null
  readonly disabled: boolean
}

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.banner": { kind: "list"; owner: Record<string, never> }
    "shell.activity": { kind: "list"; owner: Record<string, never> }
    "profile.header": { kind: "single"; owner: Record<string, never> }
    "profile.accountActions": { kind: "list"; owner: Record<string, never> }
    "settings.account": { kind: "list"; owner: Record<string, never> }
    "auth.login.footer": { kind: "list"; owner: AuthLoginFooterOwner }
  }
}
