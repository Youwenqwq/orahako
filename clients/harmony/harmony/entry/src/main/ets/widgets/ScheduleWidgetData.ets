export const SCHEDULE_FORM_NAME = 'today_schedule';
export const SCHEDULE_FORM_ABILITY = 'ScheduleFormAbility';
export const SCHEDULE_CARD_ROUTE = 'scheduleWidget';
export const WIDGET_DESTINATION_KEY = 'desktopWidgetDestination';

interface WidgetCourse {
  name: string;
  classroom?: string;
  week_day: number;
  week_list: number[];
  start_section: number;
  end_section: number;
  end_time?: string;
}

interface WidgetWeek {
  week: number;
  weekday: number;
  date?: string;
  total_weeks?: number;
}

export interface ScheduleSnapshot {
  courses: WidgetCourse[];
  week: WidgetWeek | null;
  showNextDay: boolean;
  syncedAt?: number;
}

export interface ScheduleCardItem {
  title: string;
  detail: string;
  color: string;
}

export interface ScheduleBinding {
  compact: boolean;
  heading: string;
  summary: string;
  emptyText: string;
  courses: ScheduleCardItem[];
  syncText?: string;
}

const DAY = 86_400_000;
const SCHOOL_OFFSET = 8 * 3_600_000;
const COLORS: string[] = ['#5988FA', '#4FCFA2', '#F3B711', '#E96649'];

function coursesOnDay(snapshot: ScheduleSnapshot, dayOffset: number): WidgetCourse[] {
  const anchor = snapshot.week;
  if (!anchor) return [];
  const offset = anchor.weekday - 1 + dayOffset;
  const week = anchor.week + Math.floor(offset / 7);
  if (week < 1 || (anchor.total_weeks && week > anchor.total_weeks)) return [];
  const weekday = ((offset % 7 + 7) % 7) + 1;
  return snapshot.courses
    .filter((course: WidgetCourse) => course.week_day === weekday &&
      (course.week_list.length === 0 || course.week_list.includes(week)))
    .sort((a: WidgetCourse, b: WidgetCourse) => a.start_section - b.start_section);
}

function isRemaining(course: WidgetCourse, nowMinutes: number): boolean {
  const time = course.end_time;
  if (!time || !/^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) return true;
  const parts = time.split(':');
  return Number(parts[0]) * 60 + Number(parts[1]) > nowMinutes;
}

function item(course: WidgetCourse, index: number): ScheduleCardItem {
  const sections = course.start_section === course.end_section ? String(course.start_section) :
    `${course.start_section}-${course.end_section}`;
  const classroom = course.classroom?.trim();
  return { title: course.name, detail: `第 ${sections} 节${classroom ? ' · ' + classroom : ''}`,
    color: COLORS[index % COLORS.length] };
}

export function buildScheduleBinding(snapshot: ScheduleSnapshot | null, compact: boolean,
  now: number = Date.now()): ScheduleBinding {
  const heading = '今日课表';
  if (!snapshot) {
    return { compact, heading, summary: '', emptyText: '打开应用同步课表', courses: [] };
  }
  if (!snapshot.week) {
    return { compact, heading, summary: '', emptyText: '暂未获取教学周信息', courses: [] };
  }

  const schoolDay = new Date(now + SCHOOL_OFFSET);
  const anchorDay = snapshot.week?.date ? Date.parse(`${snapshot.week.date}T00:00:00Z`) : NaN;
  const todayOffset = Math.floor((schoolDay.getTime() - anchorDay) / DAY);
  const today = coursesOnDay(snapshot, todayOffset);
  const nowMinutes = schoolDay.getUTCHours() * 60 + schoolDay.getUTCMinutes();
  let remaining = today.filter((course: WidgetCourse) => isRemaining(course, nowMinutes));
  let next = 0;
  if (remaining.length === 0 && snapshot.showNextDay && Number.isFinite(todayOffset)) {
    for (let offset = 1; offset <= 7; offset++) {
      remaining = coursesOnDay(snapshot, todayOffset + offset);
      if (remaining.length === 0) continue;
      next = offset;
      break;
    }
  }

  const nextDate = new Date(schoolDay.getTime() + next * DAY);
  const title = next === 1 ? '明日课表' : next > 1 ?
    `${nextDate.getUTCMonth() + 1} 月 ${nextDate.getUTCDate()} 日课表` : heading;
  const summary = remaining.length > 0 ? `${next === 0 ? '还有 ' : ''}${remaining.length} 节课` : '';
  return {
    compact,
    heading: title,
    summary,
    emptyText: today.length > 0 ? '今日课程已结束' : '今天没有课程',
    courses: remaining.slice(0, compact ? 2 : 4).map((course: WidgetCourse, index: number) => item(course, index))
  };
}

export function buildSchedulePreview(compact: boolean): ScheduleBinding {
  const courses: ScheduleCardItem[] = [
    { title: '数学分析', detail: '第 1-2 节 · 东区 A101', color: COLORS[0] },
    { title: '高等代数', detail: '第 3-4 节 · 西区 B203', color: COLORS[1] },
    { title: '大学英语', detail: '第 5-6 节 · 东区 C202', color: COLORS[2] },
    { title: '程序设计', detail: '第 7-8 节 · 机房 302', color: COLORS[3] }
  ];
  return { compact, heading: '今日课表', summary: '还有 4 节课', emptyText: '',
    courses: courses.slice(0, compact ? 2 : 4) };
}

export function parseScheduleSnapshot(raw: string): ScheduleSnapshot {
  const snapshot = JSON.parse(raw) as ScheduleSnapshot;
  if (!Array.isArray(snapshot.courses) || snapshot.courses.length > 512 ||
    typeof snapshot.showNextDay !== 'boolean') throw new Error('Invalid course list');
  const week = snapshot.week;
  if (week !== null && (!week || !Number.isInteger(week.week) || week.week < 1 ||
    !Number.isInteger(week.weekday) || week.weekday < 1 || week.weekday > 7 ||
    typeof week.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(week.date) ||
    !Number.isFinite(Date.parse(`${week.date}T00:00:00Z`)))) throw new Error('Invalid course week');
  for (const course of snapshot.courses) {
    if (!course || typeof course.name !== 'string' || course.name.trim().length === 0 || course.name.length > 160 ||
      (course.classroom !== undefined && (typeof course.classroom !== 'string' || course.classroom.length > 100)) ||
      !Number.isInteger(course.week_day) || course.week_day < 1 || course.week_day > 7 ||
      !Array.isArray(course.week_list) || course.week_list.length > 64 ||
      !Number.isInteger(course.start_section) || !Number.isInteger(course.end_section) ||
      course.start_section < 1 || course.end_section < course.start_section ||
      (course.end_time !== undefined && (typeof course.end_time !== 'string' || course.end_time.length > 24))) {
      throw new Error('Invalid course item');
    }
  }
  return snapshot;
}
