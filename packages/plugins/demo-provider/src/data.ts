import type {
  AcademicCompletion,
  ClassPeriod,
  ClassroomInfo,
  CodeItem,
  Course,
  CurrentWeek,
  EvaluationDetail,
  EvaluationTask,
  EvaluationType,
  Exam,
  GPAStats,
  Grade,
  GradeDistribution,
  GradeLetter,
  GradeRanking,
  GradeStatistics,
  MajorInfo,
  ProviderGPAScale,
  ProviderGradeScale,
  SchoolClassInfo,
  StudentInfo,
  TermCalendar,
  TrainingPlan,
} from "@orahako/academic-sdk"

export const DEMO_SCHOOL_ID = "demo"
export const DEMO_TERM = "2026-2027-1"
export const DEMO_PREV_TERM = "2025-2026-2"
export const DEMO_CURRENT_WEEK = 8

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base)
  next.setDate(next.getDate() + days)
  return next
}

/** Compute the Monday of week 1 so `now` always falls inside DEMO_CURRENT_WEEK. */
export function buildDemoTermCalendar(now: Date = new Date()): TermCalendar {
  const jsDay = now.getDay()
  const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay
  const currentMonday = addDays(now, mondayOffset)
  const termStart = addDays(currentMonday, -(DEMO_CURRENT_WEEK - 1) * 7)
  return {
    semester: DEMO_TERM,
    startDate: formatDate(termStart),
    totalWeeks: 18,
    teachingWeeks: 16,
    isInUse: true,
  }
}

export function buildDemoCurrentWeek(now: Date = new Date()): CurrentWeek {
  const jsDay = now.getDay()
  const weekday = jsDay === 0 ? 7 : jsDay
  const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay
  const weekStart = addDays(now, mondayOffset)
  const weekDates = Array.from({ length: 7 }, (_, idx) => formatDate(addDays(weekStart, idx)))
  return {
    semester: DEMO_TERM,
    week: DEMO_CURRENT_WEEK,
    weekday,
    date: formatDate(now),
    weekStartDate: weekDates[0],
    weekEndDate: weekDates[6],
    weekDates,
  }
}

export const DEMO_CLASS_PERIODS: readonly ClassPeriod[] = [
  { section: 1, name: "第1节", startTime: "08:00", endTime: "08:45", startMinute: 480, endMinute: 525, isInUse: true },
  { section: 2, name: "第2节", startTime: "08:55", endTime: "09:40", startMinute: 535, endMinute: 580, isInUse: true },
  { section: 3, name: "第3节", startTime: "10:00", endTime: "10:45", startMinute: 600, endMinute: 645, isInUse: true },
  { section: 4, name: "第4节", startTime: "10:55", endTime: "11:40", startMinute: 655, endMinute: 700, isInUse: true },
  { section: 5, name: "第5节", startTime: "14:00", endTime: "14:45", startMinute: 840, endMinute: 885, isInUse: true },
  { section: 6, name: "第6节", startTime: "14:55", endTime: "15:40", startMinute: 895, endMinute: 940, isInUse: true },
  { section: 7, name: "第7节", startTime: "16:00", endTime: "16:45", startMinute: 960, endMinute: 1005, isInUse: true },
  { section: 8, name: "第8节", startTime: "16:55", endTime: "17:40", startMinute: 1015, endMinute: 1060, isInUse: true },
  { section: 9, name: "第9节", startTime: "19:00", endTime: "19:45", startMinute: 1140, endMinute: 1185, isInUse: true },
  { section: 10, name: "第10节", startTime: "19:55", endTime: "20:40", startMinute: 1195, endMinute: 1240, isInUse: true },
]

const GRADE_LETTER_SET = new Set<GradeLetter>([
  "A+",
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D+",
  "D",
  "F",
  "F-",
])

export const DEMO_GRADE_SCALE: ProviderGradeScale = {
  letterOfScore(score: number): GradeLetter {
    if (score >= 95) return "A+"
    if (score >= 90) return "A"
    if (score >= 85) return "A-"
    if (score >= 80) return "B+"
    if (score >= 75) return "B"
    if (score >= 70) return "C+"
    if (score >= 60) return "D"
    return "F"
  },
  letterOfGradeLevel(gradeLevel?: string): GradeLetter | undefined {
    if (!gradeLevel) return undefined
    const trimmed = gradeLevel.trim() as GradeLetter
    return GRADE_LETTER_SET.has(trimmed) ? trimmed : undefined
  },
}

export const DEMO_GPA_SCALE: ProviderGPAScale = {
  max: 4.0,
  bands: [
    { min: 0, letter: "F" },
    { min: 1.0, letter: "D" },
    { min: 2.0, letter: "C" },
    { min: 3.0, letter: "B" },
    { min: 3.7, letter: "A" },
  ],
}

export function buildDemoStudentInfo(username: string): StudentInfo {
  return {
    name: "林酸橙",
    namePinyin: "LIN SUANCHENG",
    studentId: username || "20260101",
    gender: "女",
    department: "信息科学与工程学院",
    major: "计算机科学与技术",
    className: "计科 2401",
    gradeLevel: "2024",
    enrollmentDate: "2024-09-01",
    expectedGraduation: "2028-06-30",
    educationLevel: "本科",
    campus: "东校区",
    studentStatus: "在籍（演示模式）",
    studyDuration: "4",
  }
}

const ALL_WEEKS = Array.from({ length: 16 }, (_, i) => i + 1)
const EVEN_WEEKS = [2, 4, 6, 8, 10, 12, 14, 16]

export const DEMO_COURSES: readonly Course[] = [
  {
    name: "操作系统原理",
    code: "CS301",
    teacher: "陈明远",
    classroom: "一教 302",
    weekDay: 1,
    startSection: 1,
    endSection: 2,
    weeks: "1-16周",
    weekList: ALL_WEEKS,
    credit: "4.0",
    courseType: "专业必修",
    classId: "demo-os-1",
  },
  {
    name: "计算机网络",
    code: "CS304",
    teacher: "周清扬",
    classroom: "二教 205",
    weekDay: 1,
    startSection: 5,
    endSection: 6,
    weeks: "1-16周",
    weekList: ALL_WEEKS,
    credit: "3.5",
    courseType: "专业必修",
    classId: "demo-net-1",
  },
  {
    name: "人机交互设计",
    code: "CS318",
    teacher: "林知夏",
    classroom: "信息楼 410",
    weekDay: 2,
    startSection: 3,
    endSection: 4,
    weeks: "1-16周",
    weekList: ALL_WEEKS,
    credit: "2.5",
    courseType: "专业选修",
    classId: "demo-hci-1",
  },
  {
    name: "操作系统实验",
    code: "CS301L",
    teacher: "陈明远",
    classroom: "实验楼 B204",
    weekDay: 2,
    startSection: 7,
    endSection: 8,
    weeks: "2-16双周",
    weekList: EVEN_WEEKS,
    credit: "1.0",
    courseType: "实践环节",
    classId: "demo-os-lab",
    classType: "lab",
  },
  {
    name: "编译原理",
    code: "CS307",
    teacher: "沈墨白",
    classroom: "一教 408",
    weekDay: 3,
    startSection: 1,
    endSection: 2,
    weeks: "1-16周",
    weekList: ALL_WEEKS,
    credit: "3.5",
    courseType: "专业必修",
    classId: "demo-compiler-1",
  },
  {
    name: "现代艺术鉴赏",
    code: "GE112",
    teacher: "苏晚晴",
    classroom: "人文楼 108",
    weekDay: 3,
    startSection: 9,
    endSection: 10,
    weeks: "1-16周",
    weekList: ALL_WEEKS,
    credit: "2.0",
    courseType: "通识选修",
    classId: "demo-art-1",
  },
  {
    name: "操作系统原理",
    code: "CS301",
    teacher: "陈明远",
    classroom: "一教 302",
    weekDay: 4,
    startSection: 3,
    endSection: 4,
    weeks: "1-16周",
    weekList: ALL_WEEKS,
    credit: "4.0",
    courseType: "专业必修",
    classId: "demo-os-1",
  },
  {
    name: "分布式系统导论",
    code: "CS322",
    teacher: "陆景行",
    classroom: "信息楼 502",
    weekDay: 4,
    startSection: 5,
    endSection: 6,
    weeks: "1-16周",
    weekList: ALL_WEEKS,
    credit: "3.0",
    courseType: "专业选修",
    classId: "demo-dist-1",
  },
  {
    name: "计算机网络",
    code: "CS304",
    teacher: "周清扬",
    classroom: "二教 205",
    weekDay: 5,
    startSection: 1,
    endSection: 2,
    weeks: "1-16周",
    weekList: ALL_WEEKS,
    credit: "3.5",
    courseType: "专业必修",
    classId: "demo-net-1",
  },
  {
    name: "编译原理",
    code: "CS307",
    teacher: "沈墨白",
    classroom: "一教 408",
    weekDay: 5,
    startSection: 5,
    endSection: 6,
    weeks: "1-16周",
    weekList: ALL_WEEKS,
    credit: "3.5",
    courseType: "专业必修",
    classId: "demo-compiler-1",
  },
  {
    name: "周末创新工坊",
    code: "GE205",
    teacher: "林知夏",
    classroom: "创客空间 201",
    weekDay: 6,
    startSection: 3,
    endSection: 4,
    weeks: "1-16周",
    weekList: ALL_WEEKS,
    credit: "1.0",
    courseType: "通识选修",
    classId: "demo-maker-1",
  },
  {
    name: "开源软件实践",
    code: "CS390",
    teacher: "陆景行",
    classroom: "信息楼 306",
    weekDay: 7,
    startSection: 5,
    endSection: 6,
    weeks: "1-16周",
    weekList: ALL_WEEKS,
    credit: "1.5",
    courseType: "专业选修",
    classId: "demo-oss-1",
  },
]

export const DEMO_GRADES: readonly Grade[] = [
  {
    courseName: "数据结构与算法",
    courseCode: "CS201",
    classId: "demo-ds-1",
    score: "94",
    numericScore: 94,
    gradeLevel: "A",
    gradePoint: "4.0",
    numericGradePoint: 4.0,
    credit: "4.0",
    numericCredit: 4.0,
    hours: "64",
    semester: DEMO_TERM,
    courseType: "专业必修",
    courseCategory: "学科基础",
    examType: "考试",
    studyMode: "初修",
    isMajor: true,
    isPass: true,
    isValid: true,
    isDegreeCourse: true,
    department: "信息科学与工程学院",
  },
  {
    courseName: "计算机组成原理",
    courseCode: "CS205",
    classId: "demo-co-1",
    score: "89",
    numericScore: 89,
    gradeLevel: "A-",
    gradePoint: "3.7",
    numericGradePoint: 3.7,
    credit: "4.0",
    numericCredit: 4.0,
    hours: "64",
    semester: DEMO_TERM,
    courseType: "专业必修",
    courseCategory: "学科基础",
    examType: "考试",
    studyMode: "初修",
    isMajor: true,
    isPass: true,
    isValid: true,
    isDegreeCourse: true,
    department: "信息科学与工程学院",
  },
  {
    courseName: "人机交互设计",
    courseCode: "CS318",
    classId: "demo-hci-1",
    score: "96",
    numericScore: 96,
    gradeLevel: "A+",
    gradePoint: "4.0",
    numericGradePoint: 4.0,
    credit: "2.5",
    numericCredit: 2.5,
    hours: "40",
    semester: DEMO_TERM,
    courseType: "专业选修",
    courseCategory: "专业拓展",
    examType: "考查",
    studyMode: "初修",
    isMajor: true,
    isPass: true,
    isValid: true,
    isDegreeCourse: false,
    department: "信息科学与工程学院",
  },
  {
    courseName: "概率论与数理统计",
    courseCode: "MA204",
    classId: "demo-prob-1",
    score: "85",
    numericScore: 85,
    gradeLevel: "B+",
    gradePoint: "3.3",
    numericGradePoint: 3.3,
    credit: "3.0",
    numericCredit: 3.0,
    hours: "48",
    semester: DEMO_PREV_TERM,
    courseType: "公共必修",
    courseCategory: "通识基础",
    examType: "考试",
    studyMode: "重修",
    isMajor: true,
    isRetake: "重修",
    isPass: true,
    isValid: true,
    isDegreeCourse: true,
    department: "理学院",
  },
  {
    courseName: "离散数学",
    courseCode: "CS108",
    classId: "demo-dm-1",
    score: "91",
    numericScore: 91,
    gradeLevel: "A",
    gradePoint: "4.0",
    numericGradePoint: 4.0,
    credit: "3.5",
    numericCredit: 3.5,
    hours: "56",
    semester: DEMO_PREV_TERM,
    courseType: "专业必修",
    courseCategory: "学科基础",
    examType: "考试",
    studyMode: "初修",
    isMajor: true,
    isPass: true,
    isValid: true,
    isDegreeCourse: true,
    department: "信息科学与工程学院",
  },
  {
    courseName: "现代艺术鉴赏",
    courseCode: "GE112",
    classId: "demo-art-1",
    score: "92",
    numericScore: 92,
    gradeLevel: "A",
    gradePoint: "4.0",
    numericGradePoint: 4.0,
    credit: "2.0",
    numericCredit: 2.0,
    hours: "32",
    semester: DEMO_PREV_TERM,
    courseType: "通识选修",
    courseCategory: "通识核心",
    examType: "考查",
    studyMode: "初修",
    isMajor: false,
    isPass: true,
    isValid: true,
    isDegreeCourse: false,
    department: "人文学院",
  },
]

export const DEMO_GPA_STATS: GPAStats = {
  planName: "2024 级计算机科学与技术培养方案",
  studyType: "全日制普通本科",
  requiredCreditEarned: "82.5",
  numericRequiredCreditEarned: 82.5,
  electiveCreditEarned: "24.0",
  numericElectiveCreditEarned: 24.0,
  degreeCreditEarned: "68.0",
  numericDegreeCreditEarned: 68.0,
  requiredCreditFailed: "0",
  numericRequiredCreditFailed: 0,
  gpaInitial: "3.68",
  numericGpaInitial: 3.68,
  gpaHighest: "3.82",
  numericGpaHighest: 3.82,
  requiredGpaHighest: "3.79",
  numericRequiredGpaHighest: 3.79,
  degreeGpaInitial: "3.74",
  numericDegreeGpaInitial: 3.74,
  degreeGpaHighest: "3.85",
  numericDegreeGpaHighest: 3.85,
  weightedAvg: "90.6",
  numericWeightedAvg: 90.6,
  arithmeticAvg: "91.2",
  numericArithmeticAvg: 91.2,
  degreeWeightedAvg: "90.8",
  numericDegreeWeightedAvg: 90.8,
}

export function buildDemoGradeStatistics(courseCode?: string): GradeStatistics {
  return {
    scope: "class",
    semester: DEMO_TERM,
    courseCode,
    highestScore: 98,
    lowestScore: 63,
    averageScore: 84.6,
  }
}

export function buildDemoGradeDistribution(courseCode?: string): GradeDistribution[] {
  return [
    { scope: "class", semester: DEMO_TERM, courseCode, levelCode: "A", levelName: "90-100", count: 14 },
    { scope: "class", semester: DEMO_TERM, courseCode, levelCode: "B", levelName: "80-89", count: 22 },
    { scope: "class", semester: DEMO_TERM, courseCode, levelCode: "C", levelName: "70-79", count: 11 },
    { scope: "class", semester: DEMO_TERM, courseCode, levelCode: "D", levelName: "60-69", count: 4 },
    { scope: "class", semester: DEMO_TERM, courseCode, levelCode: "F", levelName: "<60", count: 1 },
  ]
}

export function buildDemoGradeRanking(courseCode?: string): GradeRanking {
  return {
    scope: "class",
    semester: DEMO_TERM,
    courseCode,
    score: 94,
    rank: 4,
    total: 52,
    rankingType: "教学班排名",
  }
}

export function buildDemoExams(now: Date = new Date()): Exam[] {
  const exam1Date = formatDate(addDays(now, 3))
  const exam2Date = formatDate(addDays(now, 6))
  const exam3Date = formatDate(addDays(now, 11))
  return [
    {
      name: "操作系统原理",
      examName: "期末考试",
      startAt: `${exam1Date}T09:00:00`,
      endAt: `${exam1Date}T11:00:00`,
      status: "upcoming",
      timeText: `${exam1Date} 09:00-11:00`,
      examLocation: "一教 302",
      seatNumber: "18",
    },
    {
      name: "计算机网络",
      examName: "期末考试",
      startAt: `${exam2Date}T14:30:00`,
      endAt: `${exam2Date}T16:30:00`,
      status: "upcoming",
      timeText: `${exam2Date} 14:30-16:30`,
      examLocation: "二教 205",
      seatNumber: "09",
    },
    {
      name: "编译原理",
      examName: "期末考试",
      startAt: `${exam3Date}T09:00:00`,
      endAt: `${exam3Date}T11:00:00`,
      status: "upcoming",
      timeText: `${exam3Date} 09:00-11:00`,
      examLocation: "一教 408",
      seatNumber: "27",
    },
  ]
}

export const DEMO_TRAINING_PLANS: readonly TrainingPlan[] = [
  {
    courseName: "数据结构与算法",
    courseCode: "CS201",
    credit: "4.0",
    courseType: "专业必修",
    required: true,
    term: "第3学期",
    courseGroup: "学科基础",
  },
  {
    courseName: "操作系统原理",
    courseCode: "CS301",
    credit: "4.0",
    courseType: "专业必修",
    required: true,
    term: "第5学期",
    courseGroup: "专业核心",
  },
  {
    courseName: "计算机网络",
    courseCode: "CS304",
    credit: "3.5",
    courseType: "专业必修",
    required: true,
    term: "第5学期",
    courseGroup: "专业核心",
  },
  {
    courseName: "人机交互设计",
    courseCode: "CS318",
    credit: "2.5",
    courseType: "专业选修",
    required: false,
    term: "第5学期",
    courseGroup: "专业拓展",
  },
]

export const DEMO_ACADEMIC_COMPLETION: AcademicCompletion = {
  planName: "2024 级计算机科学与技术培养方案",
  totalRequired: "165",
  numericTotalRequired: 165,
  completed: "106.5",
  numericCompleted: 106.5,
  elective: "24.0",
  numericElective: 24.0,
  passed: true,
}

export const DEMO_EVALUATION_TYPES: readonly EvaluationType[] = [
  { code: "term-end", name: "期末教学评价", count: 2 },
]

export const DEMO_INITIAL_EVALUATION_TASKS: readonly EvaluationTask[] = [
  {
    wid: "demo-eval-1",
    wjid: "demo-wj-1",
    groupNo: "demo-group-1",
    name: "2026 秋季学期课程评教",
    courseName: "人机交互设计",
    teacherName: "林知夏",
    term: DEMO_TERM,
    termName: "2026-2027 第一学期",
    evalType: "term-end",
    evalTypeName: "期末教学评价",
    status: "active",
    sequence: 1,
    className: "计科 2401",
  },
  {
    wid: "demo-eval-2",
    wjid: "demo-wj-2",
    groupNo: "demo-group-2",
    name: "2026 秋季学期课程评教",
    courseName: "操作系统原理",
    teacherName: "陈明远",
    term: DEMO_TERM,
    termName: "2026-2027 第一学期",
    evalType: "term-end",
    evalTypeName: "期末教学评价",
    status: "ended",
    sequence: 2,
    className: "计科 2401",
  },
]

export function buildDemoEvaluationDetail(groupNo: string): EvaluationDetail {
  return {
    wjid: groupNo === "demo-group-2" ? "demo-wj-2" : "demo-wj-1",
    name: "2026 秋季学期课程评教（演示）",
    questions: [
      {
        tmid: "q1",
        text: "教师备课充分，讲解清晰有条理",
        questionType: "1",
        maxScore: 100,
        order: 1,
        options: [
          { wid: "q1-a", text: "非常满意", score: 100, scoreRatio: 1 },
          { wid: "q1-b", text: "满意", score: 85, scoreRatio: 0.85 },
          { wid: "q1-c", text: "一般", score: 70, scoreRatio: 0.7 },
        ],
      },
      {
        tmid: "q2",
        text: "课程建议与反馈（演示环境，不会提交到外部服务器）",
        questionType: "3",
        maxScore: 0,
        order: 2,
        options: [],
      },
    ],
  }
}

export const DEMO_CAMPUSES: readonly CodeItem[] = [{ id: "east", name: "东校区" }]
export const DEMO_BUILDINGS: readonly CodeItem[] = [
  { id: "b1", name: "第一教学楼" },
  { id: "b2", name: "第二教学楼" },
]
export const DEMO_CLASSROOMS: readonly ClassroomInfo[] = [
  { code: "b1-302", name: "一教 302", building: "b1", buildingDisplay: "第一教学楼", campusDisplay: "东校区", classSeats: 90, typeDisplay: "多媒体" },
  { code: "b1-408", name: "一教 408", building: "b1", buildingDisplay: "第一教学楼", campusDisplay: "东校区", classSeats: 120, typeDisplay: "多媒体" },
  { code: "b2-205", name: "二教 205", building: "b2", buildingDisplay: "第二教学楼", campusDisplay: "东校区", classSeats: 60, typeDisplay: "智慧教室" },
]
export const DEMO_GRADE_YEARS: readonly CodeItem[] = [{ id: "2024", name: "2024级" }]
export const DEMO_DEPARTMENTS: readonly CodeItem[] = [{ id: "cs", name: "信息科学与工程学院" }]
export const DEMO_MAJORS: readonly MajorInfo[] = [
  { id: "cs-tech", name: "计算机科学与技术", department: "cs" },
]
export const DEMO_CLASSES: readonly SchoolClassInfo[] = [
  {
    classId: "demo-class-2401",
    className: "计科 2401",
    grade: "2024",
    gradeDisplay: "2024级",
    department: "cs",
    departmentDisplay: "信息科学与工程学院",
    major: "cs-tech",
    majorDisplay: "计算机科学与技术",
  },
]

export const DEMO_CAPTCHA_SVG_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" rx="6" fill="#f4f4f5"/><text x="60" y="26" text-anchor="middle" font-family="monospace" font-size="18" font-weight="700" fill="#18181b" letter-spacing="4">DEMO</text></svg>`
  )
