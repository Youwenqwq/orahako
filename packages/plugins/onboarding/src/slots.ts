import "@orahako/sdk"

export interface OnboardingSchoolFooterOwner {
  readonly disabled: boolean
  readonly dismissWithHandoff: (action: () => Promise<void> | void) => Promise<void>
}

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.overlay": { kind: "list"; owner: Record<string, never> }
    "debug.panels": { kind: "list"; owner: Record<string, never> }
    "onboarding.school.footer": { kind: "list"; owner: OnboardingSchoolFooterOwner }
  }
}
