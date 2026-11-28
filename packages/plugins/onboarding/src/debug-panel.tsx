import { Eye } from "lucide-react"
import type { DerivedComponentProps, SlotComponent } from "@orahako/sdk"
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@orahako/ui-primitives"
import type { OnboardingDictionary, OnboardingStoreInstance } from "./store"

export interface OnboardingDebugPanelInject {
  readonly startPreview: () => void
}

export type OnboardingDebugPanelProps = DerivedComponentProps<
  Record<string, never>,
  OnboardingDictionary,
  undefined,
  OnboardingStoreInstance,
  OnboardingDebugPanelInject
>

export const OnboardingDebugPanel: SlotComponent<OnboardingDebugPanelProps> = (props) => {
  const { t, useStore } = props
  const completed = useStore((state) => state.completed)
  const selectedSchoolId = useStore((state) => state.selectedSchoolId)

  return (
    <Card data-debug-panel="onboarding">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>{t("debugTitle")}</span>
          <Badge variant={completed ? "secondary" : "outline"} className="text-[10px]">
            {completed ? t("debugCompleted") : t("debugIncomplete")}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5 text-sm">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{t("debugSchoolLabel")}</span>
          <span className="font-mono text-foreground">
            {selectedSchoolId ?? t("debugSchoolNone")}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("debugPreviewDesc")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => props.startPreview()}
        >
          <Eye className="mr-1.5 size-3.5" />
          {t("debugPreviewAction")}
        </Button>
      </CardContent>
    </Card>
  )
}
