import "@orahako/sdk"

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.overlay": { kind: "list"; owner: Record<string, never> }
    "debug.panels": { kind: "list"; owner: Record<string, never> }
  }
}
