import { beforeEach, describe, expect, it, vi } from "vitest"
import type { HttpRequest, HttpResponse } from "@/lib/cookie"

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  fetchWithJar: vi.fn(),
}))

vi.mock("./cas", () => ({
  authorize: mocks.authorize,
  getCredentialApplied: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/cookie", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cookie")>()),
  fetchWithJar: mocks.fetchWithJar,
}))

import { queryLaborSummary, resetLdxt } from "./ldxt"

const origin = "https://ldxt.ysu.edu.cn"
const confirmUrl = `${origin}/About/UnifiedAuthenticationLogin`
const homePath = "/System/Home/Index"
const summaryPath = "/XueFen/SummaryQuery/Index"

function response(url: string, body: string, status = 200): HttpResponse {
  return {
    status,
    url,
    headers: {},
    text: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

beforeEach(() => {
  resetLdxt()
  mocks.fetchWithJar.mockReset()
  mocks.authorize.mockReset()
})

describe("labor SSO confirmation", () => {
  it("sends an explicit empty body before reading the summary", async () => {
    mocks.fetchWithJar.mockImplementation(async (_jar, request: HttpRequest) => {
      if (request.url === confirmUrl && request.method === "POST") {
        return request.body === ""
          ? response(request.url, JSON.stringify({ Success: true, Data: { Url: homePath } }))
          : response(request.url, "Length Required", 411)
      }
      if (request.url === `${origin}${homePath}`) return response(request.url, "")
      if (request.url === `${origin}${summaryPath}`) {
        return response(
          request.url,
          "<table><tr><th>劳动时长</th><th>总学分</th></tr><tr><td>12</td><td>1</td></tr></table>"
        )
      }
      throw new Error(`Unexpected request: ${request.url}`)
    })

    await expect(queryLaborSummary()).resolves.toMatchObject({ totalHours: 12, totalCredits: 1 })
    const jar = mocks.fetchWithJar.mock.calls[0]![0]
    expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith(confirmUrl, jar)
    expect(mocks.fetchWithJar).toHaveBeenCalledTimes(3)
  })

  it("reports an HTTP failure from login confirmation before reading any data", async () => {
    mocks.fetchWithJar.mockResolvedValueOnce(response(confirmUrl, "Length Required", 411))

    await expect(queryLaborSummary()).rejects.toThrow("HTTP 411")
    expect(mocks.fetchWithJar).toHaveBeenCalledTimes(1)
  })
})
