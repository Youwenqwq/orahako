import { describe, expect, it } from "vitest"
import { getSlice, ProviderErrorCode } from "@orahako/academic-sdk"
import { createDemoProvider, DEMO_SCHOOL_ID } from "../src"

describe("@orahako/plugin-demo-provider", () => {
  it("supports normal login, MFA trigger, and captcha trigger without external network", async () => {
    const provider = createDemoProvider()
    expect(provider.id).toBe(DEMO_SCHOOL_ID)

    const auth = getSlice(provider, "auth")!
    expect(auth.isAuthenticated()).toBe(false)

    // Captcha trigger when password is "captcha" and captcha text is missing
    await expect(
      auth.loginStep1({ username: "20260101", password: "captcha" })
    ).rejects.toMatchObject({ code: ProviderErrorCode.AUTH_CAPTCHA_REQUIRED })

    // MFA trigger when password is "mfa"
    const mfaStep = await auth.loginStep1({ username: "20260101", password: "mfa" })
    expect(mfaStep.needsMfa).toBe(true)
    expect(mfaStep.authenticated).toBe(false)
    expect(auth.isAuthenticated()).toBe(false)

    const challenge = await auth.requestMfaCode!({ username: "20260101", method: "sms" })
    const mfaToken = await auth.submitMfaCode!({ challenge, code: "123456" })
    expect(mfaToken).toBeTruthy()
    expect(auth.isAuthenticated()).toBe(true)

    await provider.logout()
    expect(auth.isAuthenticated()).toBe(false)

    // Direct login with any credentials
    const direct = await auth.loginStep1({ username: "any-user", password: "any-password" })
    expect(direct.authenticated).toBe(true)
    expect(direct.username).toBe("any-user")
    expect((await auth.checkAuthStatus()).authenticated).toBe(true)
  })

  it("exposes rich local sample data across academic slices", async () => {
    const provider = createDemoProvider()
    const auth = getSlice(provider, "auth")!
    await auth.login({ username: "20260101", password: "demo" })

    const profile = await getSlice(provider, "studentProfile")!.getStudentInfo()
    expect(profile.studentId).toBe("20260101")

    const courses = await getSlice(provider, "timetable")!.getSchedule()
    expect(courses.length).toBeGreaterThan(0)
    const week = await getSlice(provider, "timetable")!.getCurrentWeek!()
    expect(week.week).toBeGreaterThan(0)

    const grades = await getSlice(provider, "grades")!.getGrades()
    const gpa = await getSlice(provider, "grades")!.getGPAStats!()
    expect(grades.length).toBeGreaterThan(0)
    expect(gpa.gpaInitial).toBeTruthy()
    expect(gpa.gpaHighest).toBeTruthy()
    expect(gpa.gpaInitial).not.toBe(gpa.gpaHighest)

    const exams = await getSlice(provider, "exams")!.getExams()
    expect(exams.length).toBeGreaterThan(0)

    const evaluation = getSlice(provider, "evaluation")!
    const pendingBefore = await evaluation.getPendingEvaluations("term-end")
    expect(pendingBefore.length).toBe(1)
    await evaluation.submitEvaluation({
      groupNo: pendingBefore[0]!.groupNo!,
      wjid: pendingBefore[0]!.wjid!,
      evalType: "term-end",
      answers: [],
    })
    const pendingAfter = await evaluation.getPendingEvaluations("term-end")
    expect(pendingAfter.length).toBe(0)
  })
})
