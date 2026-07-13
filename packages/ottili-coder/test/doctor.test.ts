import { test, expect } from "bun:test"
import { report } from "../src/doctor"

test("doctor report returns environment diagnostics", async () => {
  const out = await report(process.cwd())
  expect(out).toContain("Ottili Coder doctor")
  expect(out).toContain("git version")
  expect(out).toContain("hooks")
  expect(out).toContain("provider keys present")
})
