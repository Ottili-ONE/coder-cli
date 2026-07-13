import { afterEach, expect, mock, test } from "bun:test"
import {
  createJob,
  estimateCredits,
  getCreditBalance,
  getTask,
  listCreditModels,
  listJobEvents,
  listJobTasks,
} from "../../src/cloud/cloud"

const originalFetch = globalThis.fetch
const originalUrl = process.env["OTTILI_CODER_CLOUD_URL"]
const originalToken = process.env["OTTILI_CODER_CLOUD_TOKEN"]
const originalCompany = process.env["OTTILI_CODER_CLOUD_COMPANY"]

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalUrl === undefined) delete process.env["OTTILI_CODER_CLOUD_URL"]
  else process.env["OTTILI_CODER_CLOUD_URL"] = originalUrl
  if (originalToken === undefined) delete process.env["OTTILI_CODER_CLOUD_TOKEN"]
  else process.env["OTTILI_CODER_CLOUD_TOKEN"] = originalToken
  if (originalCompany === undefined) delete process.env["OTTILI_CODER_CLOUD_COMPANY"]
  else process.env["OTTILI_CODER_CLOUD_COMPANY"] = originalCompany
})

function configure() {
  process.env["OTTILI_CODER_CLOUD_URL"] = "https://api.ottili.one"
  process.env["OTTILI_CODER_CLOUD_TOKEN"] = "ott_test_token"
  process.env["OTTILI_CODER_CLOUD_COMPANY"] = "acme"
}

test("createJob forwards requested model and credit budget", async () => {
  configure()
  let request: Request | undefined
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    request = new Request(input, init)
    return Promise.resolve(
      new Response(JSON.stringify({ viewModel: { id: 41, title: "Ship credits", status: "queued" } }), { status: 200 }),
    )
  }) as unknown as typeof fetch

  const job = await createJob({
    objective: "Ship the AI credit system",
    model: "ottili-auto",
    run_budget_credits: 120,
  })

  expect(job.id).toBe(41)
  expect(request?.url).toBe("https://api.ottili.one/api/v1/developer/modules/codehelm/actions/coder/jobs")
  expect(request?.headers.get("authorization")).toBe("Bearer ott_test_token")
  expect(request?.headers.get("x-platform-company")).toBe("acme")
  expect(await request?.json()).toEqual(
    expect.objectContaining({
      objective: "Ship the AI credit system",
      model: "ottili-auto",
      run_budget_credits: 120,
    }),
  )
})

test("getCreditBalance unwraps the shared wallet payload", async () => {
  configure()
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            viewModel: {
              current_balance: 245,
              included_remaining: 120,
              recharge_remaining: 125,
              credit_mode: "managed",
            },
          },
        }),
        { status: 200 },
      ),
    ),
  ) as unknown as typeof fetch

  const balance = await getCreditBalance()

  expect(balance.current_balance).toBe(245)
  expect(balance.credit_mode).toBe("managed")
})

test("estimateCredits unwraps the recommended budget", async () => {
  configure()
  let request: Request | undefined
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    request = new Request(input, init)
    return Promise.resolve(
      new Response(
        JSON.stringify({
          viewModel: {
            workspace_slug: "core-ops",
            metered: true,
            resolved_model: "openai/gpt-5.4-mini",
            tier: "managed",
            surface: "ottili_coder_deep",
            estimate: {
              recommended_budget: 88,
              estimated_min_credits: 50,
              estimated_max_credits: 80,
              warnings: ["Ottili Auto discount applied (5%)."],
            },
          },
        }),
        { status: 200 },
      ),
    )
  }) as unknown as typeof fetch

  const estimate = await estimateCredits({
    mode: "continuous_coding",
    target_task_count: 60,
    model: "ottili-auto/auto",
  })

  expect(request?.url).toBe("https://api.ottili.one/api/v1/developer/modules/codehelm/actions/coder/credits/estimate")
  expect(await request?.json()).toEqual({
    mode: "continuous_coding",
    target_task_count: 60,
    model: "ottili-auto/auto",
  })
  expect(estimate.surface).toBe("ottili_coder_deep")
  expect(estimate.estimate.recommended_budget).toBe(88)
})

test("listCreditModels unwraps the managed registry", async () => {
  configure()
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          result: {
            models: [
              { public_model_name: "gpt-5.4-mini", provider_name: "openai" },
              { public_model_name: "gemini-2.5-flash", provider_name: "google" },
            ],
          },
        }),
        { status: 200 },
      ),
    ),
  ) as unknown as typeof fetch

  const models = await listCreditModels()

  expect(models).toHaveLength(2)
  expect(models[0]).toEqual({ public_model_name: "gpt-5.4-mini", provider_name: "openai" })
})

test("listJobTasks unwraps the full task graph, not just summary fields", async () => {
  configure()
  globalThis.fetch = mock(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          viewModel: {
            tasks: [
              {
                id: 7,
                job_id: 41,
                title: "Build dashboard run view",
                kind: "frontend",
                status: "running",
                order: 3,
                depends_on: [1, 2],
                assigned_agent: "ottili-coder",
                files_changed: ["src/RunDashboard.tsx"],
                diff_text: "--- a/src/RunDashboard.tsx\n+++ b/src/RunDashboard.tsx\n",
              },
            ],
            count: 1,
          },
        }),
        { status: 200 },
      ),
    ),
  ) as unknown as typeof fetch

  const tasks = await listJobTasks(41)

  expect(tasks).toHaveLength(1)
  expect(tasks[0].assigned_agent).toBe("ottili-coder")
  expect(tasks[0].depends_on).toEqual([1, 2])
  expect(tasks[0].files_changed).toEqual(["src/RunDashboard.tsx"])
})

test("getTask fetches a single task including its run history", async () => {
  configure()
  let request: Request | undefined
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    request = new Request(input, init)
    return Promise.resolve(
      new Response(
        JSON.stringify({
          viewModel: {
            id: 7,
            job_id: 41,
            title: "Build dashboard run view",
            kind: "frontend",
            status: "passed",
            runs: [
              {
                id: 1,
                attempt: 1,
                agent_type: "ottili-coder",
                success: true,
                tokens_used: 4200,
                cost_dollars: 0.084,
              },
            ],
          },
        }),
        { status: 200 },
      ),
    )
  }) as unknown as typeof fetch

  const task = await getTask(7)

  expect(request?.url).toBe("https://api.ottili.one/api/v1/developer/modules/codehelm/actions/coder/tasks/7")
  expect(task.runs).toHaveLength(1)
  expect(task.runs?.[0].cost_dollars).toBe(0.084)
})

test("listJobEvents forwards after_id and limit as query params for incremental polling", async () => {
  configure()
  let request: Request | undefined
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    request = new Request(input, init)
    return Promise.resolve(
      new Response(
        JSON.stringify({
          viewModel: {
            events: [{ id: 12, job_id: 41, task_id: 7, event_type: "task.completed", message: "done", created_at: null }],
          },
        }),
        { status: 200 },
      ),
    )
  }) as unknown as typeof fetch

  const events = await listJobEvents(41, { afterId: 10, limit: 50 })

  expect(request?.url).toBe(
    "https://api.ottili.one/api/v1/developer/modules/codehelm/actions/coder/jobs/41/events?after_id=10&limit=50",
  )
  expect(events[0].event_type).toBe("task.completed")
})
