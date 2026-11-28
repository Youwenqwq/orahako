import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { applyWindowTheme, readWindowSafeArea, WindowSafeArea } from '../WindowAppearance';
import { NativeBridge, LOCAL_ORIGIN } from '../bridge/NativeBridge';
import { localResourcePath } from '../security/ResourcePolicy';
import { ClassReminderBridge } from '../reminders/ClassReminders';
import { ScheduleWidgetBridge } from '../widgets/ScheduleWidget';
import { EXAM_CARD_ROUTE } from '../widgets/ExamWidgetData';
import { SCHEDULE_CARD_ROUTE, WIDGET_DESTINATION_KEY } from '../widgets/ScheduleWidgetData';

function widgetUrl(destination: string): string | undefined {
  if (destination === EXAM_CARD_ROUTE) return `${LOCAL_ORIGIN}/dashboard/exams/`;
  if (destination === SCHEDULE_CARD_ROUTE) return `${LOCAL_ORIGIN}/dashboard/schedule/`;
  return undefined;
}

// In-memory memo of bundled resources. The rawfile snapshot only changes with an
// app update, so entries are session-scoped and never stale across versions; each
// route navigation re-requests its RSC payload and repeated sync rawfile reads are
// a visible cost on page switches.
const resourceBytes = new Map<string, ArrayBuffer>();
let resourceBytesTotal = 0;
const RESOURCE_CACHE_LIMIT = 32 * 1024 * 1024;

@Entry
@Component
struct Index {
  @State private webBackground: ResourceColor = $r('app.color.start_window_background');
  @StorageLink(WIDGET_DESTINATION_KEY) @Watch('openWidgetPage') private widgetDestination: string = '';
  private webReady: boolean = false;
  private initialUrl: string = `${LOCAL_ORIGIN}/`;
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: NativeBridge = new NativeBridge(this.controller);
  private themeQueue: Promise<void> = Promise.resolve();
  private mainWindow?: window.Window;
  private appearing: boolean = false;
  private onAvoidAreaChange = (): void => {
    this.notifySafeAreaChange();
  };

  aboutToAppear(): void {
    this.appearing = true;
    this.initialUrl = widgetUrl(this.widgetDestination) ?? this.initialUrl;
    this.widgetDestination = '';
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.bridge.initialize(context.resourceManager, (dark: boolean) => this.setTheme(dark),
      () => this.getSafeArea(), new ClassReminderBridge(context), new ScheduleWidgetBridge(context.abilityInfo.bundleName));
    window.getLastWindow(context).then((mainWindow: window.Window) => {
      if (!this.appearing) return;
      this.mainWindow = mainWindow;
      mainWindow.on('avoidAreaChange', this.onAvoidAreaChange);
      this.notifySafeAreaChange();
    }).catch(() => {});
    webview.WebviewController.setWebDebuggingAccess(false);
  }

  aboutToDisappear(): void {
    this.appearing = false;
    this.webReady = false;
    this.mainWindow?.off('avoidAreaChange', this.onAvoidAreaChange);
    this.mainWindow = undefined;
  }

  private openWidgetPage(): void {
    const destination = this.widgetDestination;
    const url = widgetUrl(destination);
    if (!url || !this.webReady) return;
    this.widgetDestination = '';
    try {
      if (this.controller.getUrl() !== url) this.controller.loadUrl(url);
    } catch {
      this.webReady = false;
      this.widgetDestination = destination;
    }
  }

  private async getSafeArea(): Promise<WindowSafeArea> {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    return readWindowSafeArea(this.mainWindow ?? await window.getLastWindow(context));
  }

  private notifySafeAreaChange(): void {
    try {
      if (!this.controller.getUrl().startsWith(`${LOCAL_ORIGIN}/`)) return;
      this.controller.runJavaScript("window.dispatchEvent(new Event('ysu-native-safe-area'))").catch(() => {});
    } catch {
      // The initial avoid-area event can arrive before the Web controller is attached.
    }
  }

  private setTheme(dark: boolean): Promise<void> {
    this.webBackground = dark ? '#0a0a0a' : '#ffffff';
    // Keep rapid theme changes ordered so an older async update cannot restore white bars.
    this.themeQueue = this.themeQueue.catch(() => {}).then(async () => {
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      await applyWindowTheme(this.mainWindow ?? await window.getLastWindow(context), dark);
    });
    return this.themeQueue;
  }

  onBackPress(): boolean {
    this.controller.runJavaScript("window.dispatchEvent(new Event('ysu-native-back'))").catch(() => {});
    return true;
  }

  private readResourceBytes(context: common.UIAbilityContext, path: string): ArrayBuffer {
    const cached = resourceBytes.get(path);
    if (cached !== undefined) return cached;
    const content = context.resourceManager.getRawFileContentSync(path);
    // ArkWeb takes an ArrayBuffer containing exactly this rawfile view.
    const bytes = new ArrayBuffer(content.byteLength);
    new Uint8Array(bytes).set(content);
    resourceBytes.set(path, bytes);
    resourceBytesTotal += bytes.byteLength;
    if (resourceBytesTotal > RESOURCE_CACHE_LIMIT) {
      // Session-scoped memo overflow: drop everything rather than tracking LRU.
      resourceBytes.clear();
      resourceBytesTotal = 0;
    }
    return bytes;
  }

  private resource(input: string): WebResourceResponse {
    const response = new WebResourceResponse();
    response.setResponseHeader([{ headerKey: 'Cache-Control', headerValue: 'no-store' }]);
    response.setResponseEncoding('utf-8');
    try {
      const path = localResourcePath(input, LOCAL_ORIGIN);
      const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
      const bytes = this.readResourceBytes(context, path);
      let mime = 'application/octet-stream';
      if (path.endsWith('.html')) mime = 'text/html';
      else if (path.endsWith('.js')) mime = 'text/javascript';
      else if (path.endsWith('.css')) mime = 'text/css';
      else if (path.endsWith('.txt')) mime = 'text/plain';
      else if (path.endsWith('.json') || path.endsWith('.webmanifest')) mime = 'application/json';
      else if (path.endsWith('.png')) mime = 'image/png';
      else if (path.endsWith('.svg')) mime = 'image/svg+xml';
      else if (path.endsWith('.woff2')) mime = 'font/woff2';
      else if (path.endsWith('.ico')) mime = 'image/x-icon';
      response.setResponseMimeType(mime);
      response.setResponseData(bytes);
      response.setResponseCode(200);
      response.setReasonMessage('OK');
    } catch {
      response.setResponseMimeType('text/plain');
      response.setResponseData('Resource unavailable');
      response.setResponseCode(403);
      response.setReasonMessage('Forbidden');
    }
    return response;
  }

  build() {
    Stack() {
      // Extend the page itself so its backdrop-filter covers the system bars as well.
      Column() {}
        .width('100%')
        .height('100%')
        .backgroundColor(this.webBackground)
        .expandSafeArea([SafeAreaType.SYSTEM, SafeAreaType.CUTOUT])
        .hitTestBehavior(HitTestMode.None)
      Web({ src: this.initialUrl, controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .darkMode(WebDarkMode.Auto)
        .forceDarkAccess(false)
        .backgroundColor(this.webBackground)
        .fileAccess(false)
        .onlineImageAccess(true)
        .multiWindowAccess(false)
        .mixedMode(MixedMode.None)
        .javaScriptProxy({ object: this.bridge, name: 'YSUHarmony',
          methodList: ['postMessage'], controller: this.controller })
        .onLoadIntercept((event) => !event?.data.getRequestUrl().startsWith(`${LOCAL_ORIGIN}/`))
        .onInterceptRequest((event) => this.resource(event?.request.getRequestUrl() ?? ''))
        .onConsole(() => true)
        .onPageEnd(() => {
          this.webReady = true;
          this.openWidgetPage();
          this.notifySafeAreaChange();
        })
        .width('100%')
        .height('100%')
        .expandSafeArea([SafeAreaType.SYSTEM, SafeAreaType.CUTOUT])
    }.width('100%').height('100%').backgroundColor(this.webBackground)
  }
}
