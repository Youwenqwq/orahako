export const EXAM_FORM_NAME = 'exam_notice';
export const EXAM_CARD_ROUTE = 'examWidget';

interface WidgetExam {
  name: string;
  start?: number;
  end?: number;
  timeText?: string;
  location?: string;
  seat?: string;
}

export interface ExamSnapshot {
  exams: WidgetExam[];
  syncedAt?: number;
}

export interface ExamCardItem {
  title: string;
  time: string;
  place: string;
}

export interface ExamBinding {
  compact: boolean;
  summary: string;
  emptyText: string;
  exams: ExamCardItem[];
  syncText?: string;
}

const SCHOOL_OFFSET = 8 * 3_600_000;

function timeLabel(exam: WidgetExam): string {
  if (exam.start === undefined) return exam.timeText || '时间待公布';
  const time = new Date(exam.start + SCHOOL_OFFSET);
  const month = time.getUTCMonth() + 1;
  const day = time.getUTCDate();
  const hour = String(time.getUTCHours()).padStart(2, '0');
  const minute = String(time.getUTCMinutes()).padStart(2, '0');
  return `${month}月${day}日 ${hour}:${minute}`;
}

export function buildExamBinding(snapshot: ExamSnapshot | null, compact: boolean,
  now: number = Date.now()): ExamBinding {
  if (snapshot === null) return { compact, summary: '', emptyText: '打开应用同步考试', exams: [] };
  const upcoming = snapshot.exams.filter((exam: WidgetExam) => (exam.end ?? exam.start ?? Infinity) >= now)
    .sort((left: WidgetExam, right: WidgetExam) => (left.start ?? Infinity) - (right.start ?? Infinity));
  return {
    compact,
    summary: upcoming.length > 0 ? `剩余 ${upcoming.length} 场` : '',
    emptyText: '暂无待考安排',
    exams: upcoming.slice(0, compact ? 1 : 3).map((exam: WidgetExam): ExamCardItem => ({
      title: exam.name,
      time: timeLabel(exam),
      place: `${exam.location || '考场待公布'}${exam.seat ? ' · 座位 ' + exam.seat : ''}`
    }))
  };
}

export function buildExamPreview(compact: boolean): ExamBinding {
  const exams: ExamCardItem[] = [
    { title: '高等数学', time: '6月18日 09:00', place: '东区 A101 · 座位 08' },
    { title: '大学英语', time: '6月20日 14:00', place: '西区 B203 · 座位 16' },
    { title: '程序设计', time: '6月23日 10:00', place: '机房 302 · 座位 24' }
  ];
  return { compact, summary: '剩余 3 场', emptyText: '', exams: exams.slice(0, compact ? 1 : 3) };
}

export function parseExamSnapshot(raw: string): ExamSnapshot {
  const snapshot = JSON.parse(raw) as ExamSnapshot;
  if (!Array.isArray(snapshot.exams) || snapshot.exams.length > 512) throw new Error('Invalid exam list');
  for (const exam of snapshot.exams) {
    if (!exam || typeof exam.name !== 'string' || exam.name.trim().length === 0 || exam.name.length > 160 ||
      (exam.start !== undefined && !isValidTimestamp(exam.start)) ||
      (exam.end !== undefined && !isValidTimestamp(exam.end)) ||
      (exam.timeText !== undefined && (typeof exam.timeText !== 'string' || exam.timeText.length > 120)) ||
      (exam.location !== undefined && (typeof exam.location !== 'string' || exam.location.length > 100)) ||
      (exam.seat !== undefined && (typeof exam.seat !== 'string' || exam.seat.length > 32))) {
      throw new Error('Invalid exam');
    }
  }
  return snapshot;
}

function isValidTimestamp(value: number): boolean {
  return Number.isFinite(value) && Number.isFinite(new Date(value + SCHOOL_OFFSET).getTime());
}
