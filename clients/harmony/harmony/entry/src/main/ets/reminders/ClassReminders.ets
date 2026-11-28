import { common } from '@kit.AbilityKit';
import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { notificationManager } from '@kit.NotificationKit';
import { liveViewManager } from '@kit.LiveViewKit';
import { BusinessError } from '@kit.BasicServicesKit';

export interface ClassAlarm {
  alarmTime: number;
  startsAt: number;
  endsAt?: number;
  courseName: string;
  classroom: string;
  startTime: string;
}

export interface ClassReminderStatus {
  scheduled: number;
  total: number;
  errorCode: number;
  liveErrorCode: number;
}

const MAX_REMINDERS = 64;
const NEXT_CLASS_WINDOW = 30 * 60_000;
const END_DISPLAY_TIME = 60_000;
const MAX_SCHEDULE_RANGE = 15 * 86400_000;
const REMINDER_GROUP = 'ysu-class-reminders';
const LIVE_VIEW_ID = 19263;
const LIVE_VIEW_EVENT = 'SCHEDULE';

function errorCode(error: Error): number {
  const code = (error as BusinessError).code;
  return Number.isSafeInteger(code) && code > 0 ? code : -1;
}

function notificationId(alarm: ClassAlarm, vibration: boolean): number {
  const signature = JSON.stringify([alarm.alarmTime, alarm.startsAt, alarm.endsAt ?? 0,
    alarm.courseName, alarm.classroom, vibration]);
  let hash = 2166136261;
  for (let i = 0; i < signature.length; i++) {
    hash = Math.imul(hash ^ signature.charCodeAt(i), 16777619);
  }
  return 0x40000000 | (hash & 0x3fffffff);
}

function isValidAlarm(alarm: ClassAlarm, now: number): boolean {
  return !!alarm && typeof alarm.courseName === 'string' && alarm.courseName.length <= 160 &&
    alarm.courseName.trim().length > 0 && !/[\r\n]/.test(alarm.courseName) &&
    typeof alarm.classroom === 'string' && alarm.classroom.length <= 100 && !/[\r\n]/.test(alarm.classroom) &&
    typeof alarm.startTime === 'string' && /^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(alarm.startTime) &&
    Number.isSafeInteger(alarm.alarmTime) && Number.isSafeInteger(alarm.startsAt) &&
    alarm.alarmTime < alarm.startsAt && alarm.startsAt - alarm.alarmTime <= 120 * 60_000 &&
    alarm.startsAt >= now - 86400_000 && alarm.startsAt <= now + MAX_SCHEDULE_RANGE &&
    (alarm.endsAt === undefined || (Number.isSafeInteger(alarm.endsAt) &&
      alarm.endsAt > alarm.startsAt && alarm.endsAt - alarm.startsAt <= 86400_000));
}

class ClassReminders {
  private queue: Promise<void> = Promise.resolve();
  private liveQueue: Promise<void> = Promise.resolve();
  private liveAlarms: ClassAlarm[] = [];
  private activeView?: liveViewManager.LiveView;
  private timer?: number;
  private liveErrorCode: number = 0;

  async requestPermission(context: common.UIAbilityContext): Promise<boolean> {
    if (await notificationManager.isNotificationEnabled()) return true;
    try {
      await notificationManager.requestEnableNotification(context);
    } catch {
      // A declined prompt can reject, so read the effective system setting.
    }
    return notificationManager.isNotificationEnabled();
  }

  sync(context: common.UIAbilityContext, alarms: ClassAlarm[], liveView: boolean,
    vibration: boolean): Promise<ClassReminderStatus> {
    if (!Array.isArray(alarms) || alarms.length > 256) throw new Error('Invalid reminder list');
    const now = Date.now();
    const ordered = alarms.filter((alarm: ClassAlarm) => isValidAlarm(alarm, now))
      .sort((a: ClassAlarm, b: ClassAlarm) => a.startsAt - b.startsAt);
    const operation = this.queue.then(async () => {
      this.liveAlarms = liveView ? ordered.filter((alarm: ClassAlarm) => alarm.endsAt !== undefined) : [];
      if (!liveView) this.liveErrorCode = 0;
      await this.refreshLiveView();
      return this.reconcile(context, ordered, vibration);
    });
    this.queue = operation.then(() => {}, () => {});
    return operation;
  }

  cancel(): Promise<void> {
    const operation = this.queue.then(async () => {
      this.liveAlarms = [];
      await this.refreshLiveView();
      this.liveErrorCode = 0;
      const reminders = await reminderAgentManager.getAllValidReminders();
      for (const reminder of reminders) {
        if (reminder.reminderReq.groupId === REMINDER_GROUP) await this.cancelReminder(reminder.reminderId);
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  private async cancelReminder(id: number): Promise<void> {
    try {
      await reminderAgentManager.cancelReminder(id);
    } catch (error) {
      if (errorCode(error as Error) !== 1700003) throw error as Error;
    }
  }

  private async reconcile(context: common.UIAbilityContext, alarms: ClassAlarm[],
    vibration: boolean): Promise<ClassReminderStatus> {
    const desired = new Map<number, ClassAlarm>();
    for (const alarm of alarms) {
      if (alarm.alarmTime > Date.now()) desired.set(notificationId(alarm, vibration), alarm);
    }
    const status: ClassReminderStatus = { scheduled: 0, total: desired.size, errorCode: 0,
      liveErrorCode: this.liveErrorCode };
    const targetIds = new Set<number>(Array.from(desired.keys()).slice(0, MAX_REMINDERS));
    try {
      for (const reminder of await reminderAgentManager.getAllValidReminders()) {
        if (reminder.reminderReq.groupId !== REMINDER_GROUP) continue;
        const id = reminder.reminderReq.notificationId;
        if (id !== undefined && targetIds.delete(id)) status.scheduled++;
        else await this.cancelReminder(reminder.reminderId);
      }
      for (const id of targetIds) {
        const alarm = desired.get(id);
        if (!alarm || alarm.alarmTime <= Date.now()) continue;
        const when = new Date(alarm.alarmTime);
        const reminder: reminderAgentManager.ReminderRequestCalendar = {
          reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
          dateTime: { year: when.getFullYear(), month: when.getMonth() + 1, day: when.getDate(),
            hour: when.getHours(), minute: when.getMinutes(), second: when.getSeconds() },
          fixedTimeZone: reminderAgentManager.TimeZoneType.FIXED_TIME_ZONE,
          title: alarm.courseName,
          content: [alarm.startTime, alarm.classroom].filter((part: string) => part.length > 0).join(' · '),
          notificationId: id,
          groupId: REMINDER_GROUP,
          ringDuration: vibration ? 3 : 0,
          slotType: notificationManager.SlotType.SERVICE_INFORMATION,
          autoDeletedTime: alarm.startsAt,
          wantAgent: { pkgName: context.abilityInfo.bundleName, abilityName: context.abilityInfo.name }
        };
        await reminderAgentManager.publishReminder(reminder);
        status.scheduled++;
      }
    } catch (error) {
      status.errorCode = errorCode(error as Error);
    }
    return status;
  }

  refreshLiveView(): Promise<void> {
    const operation = this.liveQueue.then(() => this.updateLiveView());
    this.liveQueue = operation.catch((error: Error) => { this.liveErrorCode = errorCode(error); });
    return this.liveQueue;
  }

  private async updateLiveView(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const now = Date.now();
    const ongoing = this.liveAlarms.find((alarm: ClassAlarm) =>
      alarm.startsAt <= now && (alarm.endsAt ?? 0) > now);
    const next = this.liveAlarms.find((alarm: ClassAlarm) => alarm.startsAt > now);
    const previous = this.liveAlarms.reduce<ClassAlarm | undefined>((latest, alarm) => {
      const end = alarm.endsAt ?? 0;
      return end <= now && end > (latest?.endsAt ?? 0) ? alarm : latest;
    }, undefined);
    const handoff = next && previous && next.startsAt - (previous.endsAt ?? 0) <= NEXT_CLASS_WINDOW;
    const upcoming = next && (next.alarmTime <= now || handoff) ? next : undefined;
    const ended = previous && now < (previous.endsAt ?? 0) + END_DISPLAY_TIME ? previous : undefined;
    const alarm = ongoing ?? upcoming ?? ended;
    if (!alarm) {
      if (next) this.scheduleRefresh(next.alarmTime);
      if (this.activeView) await this.stopLiveView();
      return;
    }

    const state = ongoing ? 'class' : upcoming ? 'before' : 'ended';
    const end = alarm.endsAt ?? alarm.startsAt;
    const target = ongoing ? end : upcoming ? alarm.startsAt : end + END_DISPLAY_TIME;
    this.scheduleRefresh(ongoing ? Math.min(target, now + 60_000) : target);
    if (!canIUse('SystemCapability.LiveView.LiveViewService') || !(await liveViewManager.isLiveViewEnabled())) {
      if (this.activeView) await this.stopLiveView();
      this.liveErrorCode = -1;
      return;
    }

    const label = state === 'class' ? '距下课' : state === 'before' ? '距上课' : '已下课';
    const remaining = Math.max(0, target - now);
    const progress = ongoing ? Math.floor(100 * (now - alarm.startsAt) / (end - alarm.startsAt)) :
      upcoming ? 0 : 100;
    const primary: liveViewManager.PrimaryData = {
      title: alarm.courseName,
      content: [{ text: [alarm.classroom, state === 'ended' ? label : label + ' · ${placeholder.timer}']
        .filter((part: string) => part.length > 0).join(' · ') }],
      keepTime: 0,
      layoutData: { layoutType: liveViewManager.LayoutType.LAYOUT_TYPE_PROGRESS, progress }
    };
    const view: liveViewManager.LiveView = {
      id: LIVE_VIEW_ID,
      event: LIVE_VIEW_EVENT,
      lifeCycleMode: liveViewManager.LifeCycleMode.AUTO_STOP_WHEN_APP_TERMINATE,
      isMute: true,
      liveViewData: { primary }
    };
    if (state !== 'ended') {
      view.timer = { time: remaining, isCountdown: true };
      view.liveViewData.capsule = { type: liveViewManager.CapsuleType.CAPSULE_TYPE_TIMER,
        status: 1, content: label, time: remaining, isCountdown: true };
    } else {
      view.liveViewData.capsule = { type: liveViewManager.CapsuleType.CAPSULE_TYPE_TEXT,
        status: 1, title: label };
    }
    try {
      const result = this.activeView ? await liveViewManager.updateLiveView(view) :
        await liveViewManager.startLiveView(view);
      this.activeView = view;
      this.liveErrorCode = result.resultCode;
    } catch (error) {
      const code = errorCode(error as Error);
      if (code === 1003500009 || code === 1003500010) {
        // The user or system dismissed the current view. Don't immediately recreate it.
        return;
      }
      throw error as Error;
    }
  }

  private async stopLiveView(): Promise<void> {
    const view = this.activeView;
    if (!view) return;
    try {
      await liveViewManager.stopLiveView(view);
    } catch (error) {
      const code = errorCode(error as Error);
      if (code !== 1003500009 && code !== 1003500010) throw error as Error;
    }
    this.activeView = undefined;
  }

  private scheduleRefresh(at: number): void {
    this.timer = setTimeout(() => { void this.refreshLiveView(); }, Math.max(1, at - Date.now()));
  }
}

export const classReminders = new ClassReminders();

export class ClassReminderBridge {
  private context: common.UIAbilityContext;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  checkPermission(): Promise<boolean> {
    return notificationManager.isNotificationEnabled();
  }

  requestPermission(): Promise<boolean> {
    return classReminders.requestPermission(this.context);
  }

  sync(alarms: ClassAlarm[], liveView: boolean, vibration: boolean): Promise<ClassReminderStatus> {
    return classReminders.sync(this.context, alarms, liveView, vibration);
  }

  cancel(): Promise<void> {
    return classReminders.cancel();
  }
}
