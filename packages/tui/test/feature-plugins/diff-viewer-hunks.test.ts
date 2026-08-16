import { expect, test } from "bun:test"
import {
  buildAcceptedPatch,
  buildPatch,
  countHunks,
  diffAcceptsAll,
  diffHasAccepted,
  hunkHeaders,
  isHunkHeader,
  normalizeAccepted,
  parsePatchHunks,
} from "../../src/feature-plugins/system/diff-viewer-hunks"

const SAMPLE = `diff --git a/src/file.ts b/src/file.ts
index 1111111..2222222 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,3 @@ export function one() {
   const first = true
-  const oldFirst = true
+  const newFirst = true
   const afterFirst = true
@@ -20,3 +20,3 @@ export function two() {
   const second = true
-  const oldSecond = true
+  const newSecond = true
   const afterSecond = true
@@ -40,3 +40,3 @@ export function three() {
   const third = true
-  const oldThird = true
+  const newThird = true
   const afterThird = true`

test("isHunkHeader identifies @@ lines", () => {
  expect(isHunkHeader("@@ -1,3 +1,3 @@")).toBe(true)
  expect(isHunkHeader("--- a/src/file.ts")).toBe(false)
  expect(isHunkHeader("")).toBe(false)
})

test("parsePatchHunks splits prelude and hunks", () => {
  const parsed = parsePatchHunks(SAMPLE)
  expect(parsed.prelude.length).toBe(4)
  expect(parsed.prelude[0]).toBe("diff --git a/src/file.ts b/src/file.ts")
  expect(parsed.hunks.length).toBe(3)
  expect(parsed.hunks[0].startsWith("@@ -1,3 +1,3 @@")).toBe(true)
  expect(parsed.hunks[1].startsWith("@@ -20,3 +20,3 @@")).toBe(true)
})

test("countHunks returns the number of @@ blocks", () => {
  expect(countHunks(SAMPLE)).toBe(3)
  expect(countHunks("@@ -1 +1 @@\n+added")).toBe(1)
  expect(countHunks("no hunks here")).toBe(0)
  expect(countHunks(undefined)).toBe(0)
  expect(countHunks("")).toBe(0)
})

test("hunkHeaders returns each hunk header in order", () => {
  const headers = hunkHeaders(SAMPLE)
  expect(headers.length).toBe(3)
  expect(headers[0].index).toBe(0)
  expect(headers[0].header).toBe("@@ -1,3 +1,3 @@ export function one() {")
  expect(headers[2].index).toBe(2)
})

test("buildPatch joins prelude and selected hunks", () => {
  const parsed = parsePatchHunks(SAMPLE)
  const patch = buildPatch(parsed.prelude, [parsed.hunks[0]])
  expect(patch.startsWith("diff --git")).toBe(true)
  expect(patch.includes("const newFirst = true")).toBe(true)
  expect(patch.includes("const newSecond = true")).toBe(false)
  expect(buildPatch(parsed.prelude, [])).toBe("")
})

test("buildAcceptedPatch includes only accepted hunk indices", () => {
  const accepted = buildAcceptedPatch(SAMPLE, new Set([0, 2]))
  expect(accepted.includes("const newFirst = true")).toBe(true)
  expect(accepted.includes("const newSecond = true")).toBe(false)
  expect(accepted.includes("const newThird = true")).toBe(true)
  expect(buildAcceptedPatch(SAMPLE, new Set())).toBe("")
  expect(buildAcceptedPatch(undefined, new Set([0]))).toBe("")
})

test("diffHasAccepted and diffAcceptsAll track hunk selection", () => {
  expect(diffHasAccepted(SAMPLE, new Set([1]))).toBe(true)
  expect(diffHasAccepted(SAMPLE, new Set())).toBe(false)
  expect(diffAcceptsAll(SAMPLE, new Set([0, 1, 2]))).toBe(true)
  expect(diffAcceptsAll(SAMPLE, new Set([0, 1]))).toBe(false)
  expect(diffAcceptsAll(SAMPLE, new Set())).toBe(false)
})

test("normalizeAccepted drops out-of-range hunk indices", () => {
  const total = countHunks(SAMPLE)
  const next = normalizeAccepted(SAMPLE, new Set([0, 5, -1, total + 2]))
  expect(next.has(0)).toBe(true)
  expect(next.has(5)).toBe(false)
  expect(next.has(-1)).toBe(false)
  expect(next.size).toBe(1)
})
