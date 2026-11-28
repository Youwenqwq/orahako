import {
  defineSchoolProvider,
  ProviderError,
  ProviderErrorCode,
  type AuthSlice,
  type AuthStatus,
  type Credential,
  type EvaluationSlice,
  type EvaluationTask,
  type ExamsSlice,
  type GradesSlice,
  type LoginStep1Input,
  type LoginStep1Result,
  type MfaChallenge,
  type MfaRequestInput,
  type MfaSubmitInput,
  type SchoolProvider,
  type SchoolScheduleSlice,
  type StudentProfileSlice,
  type TimetableSlice,
  type TrainingPlanSlice,
} from "@orahako/academic-sdk"
import {
  buildDemoCurrentWeek,
  buildDemoEvaluationDetail,
  buildDemoExams,
  buildDemoGradeDistribution,
  buildDemoGradeRanking,
  buildDemoGradeStatistics,
  buildDemoStudentInfo,
  buildDemoTermCalendar,
  DEMO_ACADEMIC_COMPLETION,
  DEMO_BUILDINGS,
  DEMO_CAMPUSES,
  DEMO_CAPTCHA_SVG_DATA_URL,
  DEMO_CLASS_PERIODS,
  DEMO_CLASSES,
  DEMO_CLASSROOMS,
  DEMO_COURSES,
  DEMO_DEPARTMENTS,
  DEMO_EVALUATION_TYPES,
  DEMO_GPA_SCALE,
  DEMO_GPA_STATS,
  DEMO_GRADE_SCALE,
  DEMO_GRADE_YEARS,
  DEMO_GRADES,
  DEMO_INITIAL_EVALUATION_TASKS,
  DEMO_MAJORS,
  DEMO_SCHOOL_ID,
  DEMO_TRAINING_PLANS,
} from "./data"

export const DEMO_DEFAULT_USERNAME = "20260101"
export const DEMO_DEFAULT_PASSWORD = "demo"

export function createDemoProvider(): SchoolProvider {
  let authenticated = false
  let currentUsername = DEMO_DEFAULT_USERNAME
  let pendingMfaUsername: string | null = null
  const completedEvaluationGroups = new Set<string>(
    DEMO_INITIAL_EVALUATION_TASKS.filter((task) => task.status === "ended").map(
      (task) => task.groupNo ?? task.wid
    )
  )

  const completeLogin = (username: string): void => {
    authenticated = true
    currentUsername = username.trim() || DEMO_DEFAULT_USERNAME
    pendingMfaUsername = null
  }

  const authSlice: AuthSlice = {
    async prepareLogin(): Promise<void> {},
    resetLoginSession(): void {
      pendingMfaUsername = null
    },
    async login(credential: Credential): Promise<void> {
      if (!credential.username.trim()) {
        throw new ProviderError(ProviderErrorCode.AUTH_INVALID_CREDENTIAL, "请输入学号")
      }
      completeLogin(credential.username)
    },
    async loginStep1(input: LoginStep1Input): Promise<LoginStep1Result> {
      const username = input.username.trim()
      if (!username) {
        throw new ProviderError(ProviderErrorCode.AUTH_INVALID_CREDENTIAL, "请输入学号")
      }
      const lowerPwd = input.password.trim().toLowerCase()
      if (lowerPwd === "captcha" && !input.captcha?.trim()) {
        throw new ProviderError(
          ProviderErrorCode.AUTH_CAPTCHA_REQUIRED,
          "演示模式：请输入任意验证码",
          undefined,
          undefined,
          { captchaUrl: DEMO_CAPTCHA_SVG_DATA_URL }
        )
      }
      if (lowerPwd === "mfa") {
        pendingMfaUsername = username
        return {
          authenticated: false,
          needsMfa: true,
          username,
        }
      }
      completeLogin(username)
      return {
        authenticated: true,
        needsMfa: false,
        username,
        credential: "demo-session-token",
      }
    },
    async checkAuthStatus(): Promise<AuthStatus> {
      return { authenticated }
    },
    isAuthenticated(): boolean {
      return authenticated
    },
    getCaptchaUrl(): string {
      return DEMO_CAPTCHA_SVG_DATA_URL
    },
    async checkCaptchaNeeded(username: string): Promise<boolean> {
      return username.trim().toLowerCase() === "captcha"
    },
    async requestMfaCode(input: MfaRequestInput): Promise<MfaChallenge> {
      return {
        method: input.method,
        methodCode: "demo",
        mobileHint: "138****0101（演示模式：输入任意验证码即可）",
        username: input.username || pendingMfaUsername || currentUsername,
      }
    },
    async submitMfaCode(input: MfaSubmitInput): Promise<string> {
      if (!input.code.trim()) {
        throw new ProviderError(ProviderErrorCode.AUTH_INVALID_CREDENTIAL, "请输入验证码")
      }
      completeLogin(input.challenge.username || pendingMfaUsername || currentUsername)
      return "demo-session-token"
    },
  }

  const studentProfileSlice: StudentProfileSlice = {
    async getStudentInfo() {
      return buildDemoStudentInfo(currentUsername)
    },
  }

  const timetableSlice: TimetableSlice = {
    scheduleRules: {
      timeZone: "Asia/Shanghai",
      lunchAfter: 4,
      dinnerAfter: 8,
    },
    hasLabSchedule: true,
    async getSchedule() {
      return [...DEMO_COURSES]
    },
    async getUnscheduledCourses() {
      return []
    },
    async getClassPeriods() {
      return [...DEMO_CLASS_PERIODS]
    },
    async getTermCalendar() {
      return buildDemoTermCalendar()
    },
    async getCurrentWeek() {
      return buildDemoCurrentWeek()
    },
    async getCurrentWeekNumber() {
      return buildDemoCurrentWeek().week
    },
  }

  const gradesSlice: GradesSlice = {
    gradeScale: DEMO_GRADE_SCALE,
    gpaScale: DEMO_GPA_SCALE,
    async getGrades(options) {
      return DEMO_GRADES.filter((grade) => {
        if (options?.semester && grade.semester !== options.semester) return false
        if (options?.courseName && !grade.courseName.includes(options.courseName)) return false
        return true
      })
    },
    async getGPAStats() {
      return { ...DEMO_GPA_STATS }
    },
    async getGradeStatistics(options) {
      return buildDemoGradeStatistics(options?.courseCode)
    },
    async getGradeDistribution(options) {
      return buildDemoGradeDistribution(options?.courseCode)
    },
    async getGradeRanking(options) {
      return buildDemoGradeRanking(options?.courseCode)
    },
  }

  const examsSlice: ExamsSlice = {
    async getExams() {
      return buildDemoExams()
    },
  }

  const trainingPlanSlice: TrainingPlanSlice = {
    async getTrainingPlan() {
      return [...DEMO_TRAINING_PLANS]
    },
    async getAcademicCompletion() {
      return { ...DEMO_ACADEMIC_COMPLETION }
    },
    async recalculateAcademicCompletion() {
      return { ...DEMO_ACADEMIC_COMPLETION }
    },
    async getAcademicWarnings() {
      return []
    },
  }

  const evaluationSlice: EvaluationSlice = {
    async getEvaluationTypes() {
      return [...DEMO_EVALUATION_TYPES]
    },
    async getPendingEvaluations() {
      return DEMO_INITIAL_EVALUATION_TASKS.filter(
        (task) => !completedEvaluationGroups.has(task.groupNo ?? task.wid)
      )
    },
    async getEvaluationTasks(): Promise<EvaluationTask[]> {
      return DEMO_INITIAL_EVALUATION_TASKS.map((task) => ({
        ...task,
        status: completedEvaluationGroups.has(task.groupNo ?? task.wid) ? "ended" : "active",
      }))
    },
    async getEvaluationDetail(query) {
      return buildDemoEvaluationDetail(query.groupNo)
    },
    async submitEvaluation(input) {
      completedEvaluationGroups.add(input.groupNo)
    },
  }

  const schoolScheduleSlice: SchoolScheduleSlice = {
    async getSchoolGradeYears() {
      return [...DEMO_GRADE_YEARS]
    },
    async getSchoolDepartments() {
      return [...DEMO_DEPARTMENTS]
    },
    async getSchoolMajors() {
      return [...DEMO_MAJORS]
    },
    async getSchoolClasses() {
      return [...DEMO_CLASSES]
    },
    async getSchoolClassSchedule() {
      return [...DEMO_COURSES]
    },
    async getSchoolCampuses() {
      return [...DEMO_CAMPUSES]
    },
    async getSchoolBuildings() {
      return [...DEMO_BUILDINGS]
    },
    async getSchoolClassrooms() {
      return [...DEMO_CLASSROOMS]
    },
    async getSchoolClassroomSchedule() {
      return DEMO_COURSES.slice(0, 4)
    },
  }

  return defineSchoolProvider({
    id: DEMO_SCHOOL_ID,
    name: "演示大学",
    timeZone: "Asia/Shanghai",
    slices: {
      auth: authSlice,
      studentProfile: studentProfileSlice,
      timetable: timetableSlice,
      grades: gradesSlice,
      exams: examsSlice,
      trainingPlan: trainingPlanSlice,
      evaluation: evaluationSlice,
      schoolSchedule: schoolScheduleSlice,
    },
    async initialize(): Promise<void> {},
    async reset(): Promise<void> {
      authenticated = false
      pendingMfaUsername = null
    },
    async logout(): Promise<void> {
      authenticated = false
      pendingMfaUsername = null
    },
    async dispose(): Promise<void> {},
    async relogin(): Promise<boolean> {
      authenticated = true
      return true
    },
  })
}
