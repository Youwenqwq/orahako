import { Want } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { formBindingData, formInfo, formProvider } from '@kit.FormKit';
import { SecureStore } from '../security/SecureStore';
import { buildExamBinding, EXAM_FORM_NAME, parseExamSnapshot } from './ExamWidgetData';
import { buildScheduleBinding, parseScheduleSnapshot, SCHEDULE_FORM_ABILITY,
  SCHEDULE_FORM_NAME } from './ScheduleWidgetData';

interface WidgetPreferences {
  syncReminderHours: number;
  showNextDay?: boolean;
}

interface LastSync {
  input: string;
  stored: string;
  syncedAt: number;
}

const PREFERENCES_KEY = 'widget-preferences';
const FORM_NAMES: string[] = [SCHEDULE_FORM_NAME, EXAM_FORM_NAME];
const DEFAULT_PREFERENCES: WidgetPreferences = { syncReminderHours: 24 };
const FORM_NOT_FOUND = 16501001;
const store = new SecureStore();
const lastSyncs = new Map<string, LastSync>();
let queue: Promise<void> = Promise.resolve();

function serialize(task: () => Promise<void>): Promise<void> {
  const operation = queue.then(task);
  queue = operation.catch(() => {});
  return operation;
}

function cacheKey(formName: string): string {
  return formName === EXAM_FORM_NAME ? 'exam-widget' : 'schedule-widget';
}

export function isWidgetPreview(location: number): boolean {
  return location === formInfo.FormLocation.FORM_CENTER || location === formInfo.FormLocation.FORM_MANAGER;
}

async function readPreferences(): Promise<WidgetPreferences> {
  const raw = await store.get(PREFERENCES_KEY);
  return raw ? JSON.parse(raw) as WidgetPreferences : DEFAULT_PREFERENCES;
}

function lastSyncLabel(syncedAt: number | undefined, hours: number, now: number): string {
  if (!syncedAt || hours <= 0 || now - syncedAt < hours * 3_600_000) return '';
  const time = new Date(syncedAt + 8 * 3_600_000);
  const date = time.toISOString().slice(5, 16).replace('T', ' ');
  return `上次同步 ${date}`;
}

function cardData(formName: string, raw: string | null, compact: boolean, preferences: WidgetPreferences): string {
  const now = Date.now();
  if (formName === EXAM_FORM_NAME) {
    const snapshot = raw ? parseExamSnapshot(raw) : null;
    const binding = buildExamBinding(snapshot, compact, now);
    binding.syncText = lastSyncLabel(snapshot?.syncedAt, preferences.syncReminderHours, now);
    return JSON.stringify(binding);
  }
  const snapshot = raw ? parseScheduleSnapshot(raw) : null;
  if (snapshot && preferences.showNextDay !== undefined) snapshot.showNextDay = preferences.showNextDay;
  const binding = buildScheduleBinding(snapshot, compact, now);
  binding.syncText = lastSyncLabel(snapshot?.syncedAt, preferences.syncReminderHours, now);
  return JSON.stringify(binding);
}

async function updatePublished(bundleName: string, snapshots: Map<string, string | null>,
  preferences: WidgetPreferences): Promise<void> {
  const forms = await formProvider.getPublishedRunningFormInfos();
  const ids = new Set<string>();
  let failed = false;
  for (const form of forms) {
    const raw = snapshots.get(form.formName);
    if (form.bundleName !== bundleName || form.abilityName !== SCHEDULE_FORM_ABILITY ||
      raw === undefined || isWidgetPreview(form.formLocation) || ids.has(form.formId)) continue;
    ids.add(form.formId);
    try {
      const data = cardData(form.formName, raw, form.dimension === formInfo.FormDimension.Dimension_2_2, preferences);
      await formProvider.updateForm(form.formId, formBindingData.createFormBindingData(data));
    } catch (error) {
      if ((error as BusinessError).code !== FORM_NOT_FOUND) failed = true;
    }
  }
  if (failed) throw new Error('未能更新桌面卡片');
}

export function refreshWidget(formId: string, formName?: string, compact?: boolean): Promise<void> {
  return serialize(async () => {
    let compactCard = compact;
    let name = formName;
    if (compactCard === undefined || name === undefined) {
      const info = await formProvider.getPublishedRunningFormInfoById(formId);
      if (isWidgetPreview(info.formLocation) || !FORM_NAMES.includes(info.formName)) return;
      compactCard = info.dimension === formInfo.FormDimension.Dimension_2_2;
      name = info.formName;
    }
    const raw = await store.get(cacheKey(name));
    const data = cardData(name, raw, compactCard, await readPreferences());
    await formProvider.updateForm(formId, formBindingData.createFormBindingData(data));
  });
}

async function refreshPublished(bundleName: string, preferences: WidgetPreferences): Promise<void> {
  const snapshots = new Map<string, string | null>();
  for (const name of FORM_NAMES) {
    try {
      snapshots.set(name, lastSyncs.get(name)?.stored ?? await store.get(cacheKey(name)));
    } catch {
      // Keep the last rendered card when encrypted storage is temporarily unavailable.
    }
  }
  if (snapshots.size > 0) await updatePublished(bundleName, snapshots, preferences);
}

export function refreshPublishedWidgets(bundleName: string): Promise<void> {
  return serialize(async () => refreshPublished(bundleName, await readPreferences()));
}

export class ScheduleWidgetBridge {
  private bundleName: string;

  constructor(bundleName: string) {
    this.bundleName = bundleName;
  }

  openManager(compact: boolean, exam: boolean = false): void {
    const want: Want = {
      bundleName: this.bundleName,
      abilityName: SCHEDULE_FORM_ABILITY,
      parameters: {
        'ohos.extra.param.key.form_dimension': compact ? formInfo.FormDimension.Dimension_2_2 :
          formInfo.FormDimension.Dimension_2_4,
        'ohos.extra.param.key.form_name': exam ? EXAM_FORM_NAME : SCHEDULE_FORM_NAME,
        'ohos.extra.param.key.module_name': 'entry'
      }
    };
    formProvider.openFormManager(want);
  }

  sync(raw: string, exam: boolean = false): Promise<void> {
    if (raw.length > 96_000) throw new Error('Widget data too large');
    const formName = exam ? EXAM_FORM_NAME : SCHEDULE_FORM_NAME;
    return serialize(async () => {
      const now = Date.now();
      let previous = lastSyncs.get(formName);
      if (!previous || previous.input !== raw || now - previous.syncedAt >= 60_000) {
        const snapshot = exam ? parseExamSnapshot(raw) : parseScheduleSnapshot(raw);
        snapshot.syncedAt = now;
        const stored = JSON.stringify(snapshot);
        await store.set(cacheKey(formName), stored);
        previous = { input: raw, stored, syncedAt: now };
        lastSyncs.set(formName, previous);
      }
      const snapshots = new Map<string, string | null>();
      snapshots.set(formName, previous.stored);
      await updatePublished(this.bundleName, snapshots, await readPreferences());
    });
  }

  setPreferences(hours: number, showNextDay: boolean): Promise<void> {
    if (!Number.isInteger(hours) || hours < 0 || hours > 168) throw new Error('Invalid widget preferences');
    const preferences: WidgetPreferences = { syncReminderHours: hours, showNextDay };
    return serialize(async () => {
      await store.set(PREFERENCES_KEY, JSON.stringify(preferences));
      await refreshPublished(this.bundleName, preferences).catch(() => {});
    });
  }

  clear(): Promise<void> {
    return serialize(async () => {
      lastSyncs.clear();
      const snapshots = new Map<string, string | null>();
      let failed = false;
      for (const name of FORM_NAMES) {
        snapshots.set(name, null);
        try {
          await store.remove(cacheKey(name));
        } catch {
          failed = true;
        }
      }
      await updatePublished(this.bundleName, snapshots, DEFAULT_PREFERENCES);
      if (failed) throw new Error('未能清理桌面卡片数据');
    });
  }
}
