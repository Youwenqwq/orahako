import { UIAbility, ConfigurationConstant, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { applyWindowTheme } from '../WindowAppearance';
import { classReminders } from '../reminders/ClassReminders';
import { refreshPublishedWidgets } from '../widgets/ScheduleWidget';
import { EXAM_CARD_ROUTE } from '../widgets/ExamWidgetData';
import { SCHEDULE_CARD_ROUTE, WIDGET_DESTINATION_KEY } from '../widgets/ScheduleWidgetData';

interface WidgetRoute { destination?: string; }

export default class EntryAbility extends UIAbility {
  onCreate(want: Want): void {
    this.handleWidgetRoute(want);
  }

  onNewWant(want: Want): void {
    this.handleWidgetRoute(want);
  }

  private handleWidgetRoute(want: Want): void {
    const raw = want.parameters?.['params'];
    if (typeof raw !== 'string' || raw.length > 256) return;
    try {
      const params = JSON.parse(raw) as WidgetRoute;
      if (params.destination === SCHEDULE_CARD_ROUTE || params.destination === EXAM_CARD_ROUTE) {
        AppStorage.setOrCreate(WIDGET_DESTINATION_KEY, params.destination);
      }
    } catch {
      // An unrelated Want does not change the app route.
    }
  }

  onForeground(): void {
    void classReminders.refreshLiveView();
    void refreshPublishedWidgets(this.context.abilityInfo.bundleName).catch(() => {});
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    const mainWindow = windowStage.getMainWindowSync();
    mainWindow.setWindowLayoutFullScreen(true).catch(() => {}).then(() => {
      const dark = this.context.config.colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
      applyWindowTheme(mainWindow, dark).catch(() => {});
      windowStage.loadContent('pages/Index');
    });
  }
}
