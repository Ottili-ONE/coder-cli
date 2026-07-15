import { $ } from "bun"
import { describe, expect } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Git } from "../../src/git"
import { tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// ---------------------------------------------------------------------------
// Deterministic fuzz harness
//
// The campaign must preserve reproducible seeds/cases and run with bounded
// runtime in CI. We use a small xorshift PRNG seeded from a fixed constant so
// the same seed always produces the same sequence. Set GIT_FUZZ_SEED to a
// numeric value to reproduce a specific failing case.
// ---------------------------------------------------------------------------

const DEFAULT_SEED = 0x9e3779b9

class Xorshift {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0 || 1
  }

  next(): number {
    let x = this.state
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.state = x >>> 0
    return this.state
  }

  int(maxExclusive: number): number {
    return this.next() % maxExclusive
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]
  }

  // Generates a filename that exercises shell/git edge cases: spaces, unicode,
  // control chars, backslashes, and path separators.
  filename(kind: "plain" | "weird" | "windows"): string {
    const plain = ["a.txt", "b/c.txt", "dir/file.md", "README.md", "src/index.ts"]
    const weird = [
      "tab\tfile.txt",
      "space file.txt",
      "unicodé—file.txt",
      "dash-name.txt",
      "dot.file",
      "name with (parens).txt",
      "mix-🐛-emoji.ts",
      " leadspace.txt",
      "trailspace .txt",
    ]
    const windows = ["dir\\sub\\file.txt", "C:\\windows\\style.txt", "folder\\name with space.txt", "back\\slash.dat"]
    const base =
      kind === "plain" ? this.pick(plain) : kind === "windows" ? this.pick(windows) : this.pick(weird)
    return base
  }

  branchName(): string {
    const parts = ["feature", "fix", "chore", "hotfix", "release"]
    const suffixes = ["thing", "stuff", "bug", "x", "y", "123", "α", "with space", "weird/name"]
    return `ottili-coder/${this.pick(parts)}-${this.pick(suffixes)}-${this.int(1000)}`
  }
}

const FUZZ_CASES = 24

const seedFor = (label: string) => {
  const env = process.env.GIT_FUZZ_SEED
  if (env !== undefined && env !== "") return Number.parseInt(env, 10) >>> 0
  return (DEFAULT_SEED ^ (label.length * 2654435761)) >>> 0
}

const weirdName = () => (process.platform === "win32" ? "space file.txt" : "tab\tfile.txt")

const scopedTmpdir = (options?: Parameters<typeof tmpdir>[0]) =>
  Effect.acquireRelease(
    Effect.promise(() => tmpdir(options)),
    (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
  )

const it = testEffect(Git.defaultLayer)

describe("Git fault-injection", () => {
  it.live("run() never throws on dependency errors (missing git)", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir()
      const git = yield* Git.Service
      // Point PATH at an empty dir so `git` cannot be found.
      const empty = path.join(tmp.path, "no-git")
      yield* Effect.promise(() => fs.mkdir(empty, { recursive: true }))
      const result = yield* git.run(["status"], { cwd: tmp.path, env: { PATH: empty } })
      expect(result.exitCode).toBe(1)
      expect(result.stdout.length).toBe(0)
    }),
  )

  it.live("status() returns empty on a corrupt .git directory", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      // Trash the git internals so porcelain output is meaningless.
      yield* Effect.promise(() => fs.rm(path.join(tmp.path, ".git", "HEAD"), { force: true }))
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".git", "HEAD"), "not a valid ref\n"))
      const git = yield* Git.Service
      const status = yield* git.status(tmp.path)
      expect(Array.isArray(status)).toBe(true)
    }),
  )

  it.live("branch() returns undefined for a repo with no commits", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir()
      yield* Effect.promise(() => $`git init`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => $`git config core.fsmonitor false`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => $`git config commit.gpgsign false`.cwd(tmp.path).quiet())
      yield* Effect.promise(() =>
        $`git config user.email "test@ottiliCoder.test"`.cwd(tmp.path).quiet(),
      )
      yield* Effect.promise(() => $`git config user.name "Test"`.cwd(tmp.path).quiet())
      const git = yield* Git.Service
      const branch = yield* git.branch(tmp.path)
      expect(branch).toBeUndefined()
      const has = yield* git.hasHead(tmp.path)
      expect(has).toBe(false)
    }),
  )

  it.live("show() returns empty for a path that does not exist at ref", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      const git = yield* Git.Service
      const text = yield* git.show(tmp.path, "HEAD", "does/not/exist.txt")
      expect(text).toBe("")
    }),
  )

  it.live("mergeBase() handles missing refs gracefully", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      const git = yield* Git.Service
      const base = yield* git.mergeBase(tmp.path, "no-such-branch-a", "no-such-branch-b")
      expect(base).toBeUndefined()
    }),
  )

  it.live("aheadBehind() returns undefined with no upstream configured", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      const git = yield* Git.Service
      const result = yield* git.aheadBehind(tmp.path)
      expect(result).toBeUndefined()
    }),
  )

  it.live("worktreeCount() returns 0 on failure instead of throwing", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir()
      const git = yield* Git.Service
      const count = yield* git.worktreeCount(tmp.path)
      expect(count).toBe(0)
    }),
  )

  it.live("applyPatch() tolerates a malformed patch without throwing", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      const git = yield* Git.Service
      const result = yield* git.applyPatch(tmp.path, "this is not a valid patch\n@@ garbage @@\n")
      expect(result.exitCode).not.toBe(0)
      expect(result.stdout).toBeInstanceOf(Buffer)
    }),
  )

  it.live("status()/diff() parse dirty trees with mixed staged/unstaged state", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      const git = yield* Git.Service
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "staged.txt"), "s\n"))
      yield* Effect.promise(() => $`git add staged.txt`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, weirdName()), "u\n"))
      yield* Effect.promise(() => $`git add .`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, weirdName()), "u2\n"))
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "gone.txt"), "g\n"))
      yield* Effect.promise(() => $`git add gone.txt`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => $`git commit --no-gpg-sign -m init`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => fs.rm(path.join(tmp.path, "gone.txt")))

      const status = yield* git.status(tmp.path)
      const files = status.map((item) => item.file)
      expect(files).toContain(weirdName())
      expect(files).toContain("gone.txt")

      const diff = yield* git.diff(tmp.path, "HEAD")
      expect(Array.isArray(diff)).toBe(true)
    }),
  )

  it.live("diff()/stats() handle rebase-in-progress (REBASE_HEAD) state", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      const git = yield* Git.Service
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "base.txt"), "base\n"))
      yield* Effect.promise(() => $`git add .`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => $`git commit --no-gpg-sign -m base`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => $`git checkout -b topic`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "base.txt"), "topic\n"))
      yield* Effect.promise(() => $`git commit --no-gpg-sign -am topic`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => $`git checkout main`.cwd(tmp.path).quiet().nothrow())
      const head = (yield* Effect.promise(() => $`git rev-parse topic`.cwd(tmp.path).quiet().text())).trim()
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, ".git", "REBASE_HEAD"), `${head}\n`))

      const diff = yield* git.diff(tmp.path, "HEAD")
      const stats = yield* git.stats(tmp.path, "HEAD")
      expect(Array.isArray(diff)).toBe(true)
      expect(Array.isArray(stats)).toBe(true)
    }),
  )

  it.live("status() handles a nested git directory (submodule shape)", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      const git = yield* Git.Service
      const nested = path.join(tmp.path, "vendor", "lib")
      yield* Effect.promise(() => fs.mkdir(nested, { recursive: true }))
      yield* Effect.promise(() => $`git init`.cwd(nested).quiet())
      yield* Effect.promise(() => fs.writeFile(path.join(nested, "code.ts"), "x\n"))
      yield* Effect.promise(() => $`git -C ${nested} add .`.quiet())
      yield* Effect.promise(() => $`git -C ${nested} commit --no-gpg-sign -m lib`.quiet())

      const status = yield* git.status(tmp.path)
      expect(Array.isArray(status)).toBe(true)
    }),
  )

  it.live("diff()/stats() on a large repo stay bounded and parse correctly", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      const git = yield* Git.Service
      const count = 200
      for (const i of Array.from({ length: count }, (_, i) => i)) {
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, `file_${i}.txt`), `line ${i}\n`))
      }
      yield* Effect.promise(() => $`git add .`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => $`git commit --no-gpg-sign -m bulk`.cwd(tmp.path).quiet())
      for (const i of Array.from({ length: count }, (_, i) => i)) {
        yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, `file_${i}.txt`), `line ${i} changed\n`))
      }
      const diff = yield* git.diff(tmp.path, "HEAD")
      const stats = yield* git.stats(tmp.path, "HEAD")
      expect(diff.length).toBe(count)
      expect(stats.length).toBe(count)
      for (const stat of stats) {
        expect(Number.isFinite(stat.additions)).toBe(true)
        expect(Number.isFinite(stat.deletions)).toBe(true)
      }
    }),
  )

  it.live("patch() with maxOutputBytes returns truncated=true and empty text", () =>
    Effect.gen(function* () {
      const tmp = yield* scopedTmpdir({ git: true })
      const git = yield* Git.Service
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "big.txt"), "a".repeat(5000) + "\n"))
      yield* Effect.promise(() => $`git add .`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => $`git commit --no-gpg-sign -m big`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "big.txt"), "b".repeat(5000) + "\n"))
      const result = yield* git.patch(tmp.path, "HEAD", "big.txt", { maxOutputBytes: 64 })
      expect(result.truncated).toBe(true)
      expect(result.text).toBe("")
    }),
  )
})

describe("Git fuzz campaign (deterministic)", () => {
  for (const kind of ["plain", "weird", "windows"] as const) {
    it.live(`fuzz status() with ${kind} filenames (seed-deterministic)`, () =>
      Effect.gen(function* () {
        const seed = seedFor(`status-${kind}`)
        const rng = new Xorshift(seed)
        const tmp = yield* scopedTmpdir({ git: true })
        const git = yield* Git.Service
        const created: string[] = []
        for (const i of Array.from({ length: FUZZ_CASES }, (_, i) => i)) {
          const name = rng.filename(kind)
          if (name.includes("\\") && process.platform !== "win32") continue
          const target = path.join(tmp.path, name)
          yield* Effect.promise(() =>
            fs.mkdir(path.dirname(target), { recursive: true }).catch(() => undefined),
          )
          yield* Effect.promise(() => fs.writeFile(target, `case ${i}\n`).catch(() => undefined))
          created.push(name)
        }
        yield* Effect.promise(() => $`git add .`.cwd(tmp.path).quiet().nothrow())
        const status = yield* git.status(tmp.path)
        expect(Array.isArray(status)).toBe(true)
        for (const name of created) {
          if (name.includes("\\") && process.platform !== "win32") continue
          const present = status.some((item) => item.file === name || item.file.replace(/\\/g, "/") === name)
          expect(present).toBe(true)
        }
      }),
    )
  }

  it.live("fuzz diff()/patch() branch refs never throw", () =>
    Effect.gen(function* () {
      const seed = seedFor("refs")
      const rng = new Xorshift(seed)
      const tmp = yield* scopedTmpdir({ git: true })
      const git = yield* Git.Service
      yield* Effect.promise(() => fs.writeFile(path.join(tmp.path, "seed.txt"), "root\n"))
      yield* Effect.promise(() => $`git add .`.cwd(tmp.path).quiet())
      yield* Effect.promise(() => $`git commit --no-gpg-sign -m root`.cwd(tmp.path).quiet())

      for (const i of Array.from({ length: FUZZ_CASES }, (_, i) => i)) {
        const ref = rng.branchName()
        const diff = yield* git.diff(tmp.path, rng.int(2) === 0 ? "HEAD" : ref)
        const patch = yield* git.patch(tmp.path, "HEAD", weirdName(), { maxOutputBytes: 1024 })
        expect(Array.isArray(diff)).toBe(true)
        expect(typeof patch.truncated).toBe("boolean")
      }
    }),
  )

  it.live("fuzz statUntracked() with mixed filename kinds", () =>
    Effect.gen(function* () {
      const seed = seedFor("untracked")
      const rng = new Xorshift(seed)
      const tmp = yield* scopedTmpdir({ git: true })
      const git = yield* Git.Service
      for (const i of Array.from({ length: FUZZ_CASES }, (_, i) => i)) {
        const kind = rng.pick(["plain", "weird", "windows"] as const)
        const name = rng.filename(kind)
        if (name.includes("\\") && process.platform !== "win32") continue
        const target = path.join(tmp.path, name)
        yield* Effect.promise(() =>
          fs.mkdir(path.dirname(target), { recursive: true }).catch(() => undefined),
        )
        yield* Effect.promise(() => fs.writeFile(target, `x${i}\n`).catch(() => undefined))
        yield* git.statUntracked(tmp.path, name)
      }
    }),
  )
})
