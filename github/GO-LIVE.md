# Ottili Coder — Go-Live Checklist

Status of the Option-1 (GitHub Actions) path. Everything on the Ottili side is
done and verified; the remaining items are GitHub-UI clicks that only a repo
admin can do.

## ✅ Done (Ottili side, verified)
- Engine deployed & live (CodeHelm `coder_engine`, auth-gated coder/* routes).
- GitHub App credentials configured in the container (`GITHUB_APP_ID`, key).
- Connect/install/webhook endpoints exist (`/api/v1/codehelm/github/*`).
- CLI built and distributed: `curl -fsSL https://ottili.one/coder/install | bash`
  installs a working `ottili-coder` (linux-x64), checksum-verified.
- App slug corrected to `ottili-coder` everywhere (env-configurable;
  `OTTILI_CODER_GITHUB_APP_SLUG`).
- Action references env-configurable: `OTTILI_CODER_GITHUB_ACTION_REF`,
  `OTTILI_CODER_INSTALL_URL`, `OTTILI_CODER_RELEASE_REPO`.
- `ottili.one` 502 fixed (edge config drift).

## ⛔ Only you can do (GitHub UI — no code can replace these)
1. **Install the GitHub App** `https://github.com/apps/ottili-coder` on the
   target repo. GitHub then returns a real `installation_id`; the dashboard's
   "connect repo" flow records it (replacing the local stub `installation_id=0`).
2. **Add the model secret**: repo/org → Settings → Secrets and variables →
   Actions → `ANTHROPIC_API_KEY = sk-ant-...`.
3. **Publish the action** to a PRIVATE repo (push this `github/` dir there) and
   set `uses: <your-org>/<repo>/github@<tag>` in the workflow — OR vendor it
   locally (copy `github/` to `.github/actions/ottili-coder` in the target repo
   and use `uses: ./.github/actions/ottili-coder`). No open source needed.
4. **Add the workflow** `.github/workflows/ottili-coder.yml` (see
   `workflow-example.yml`).

## ▶️ Then it runs
Comment `/ottili-coder fix the failing test` on an issue/PR → the runner installs
the CLI, runs the agent, opens a PR. Or start it from CodeHelm / the CLI:
`ottili-coder cloud run "<task>" --repo <id> --watch`.

## Not yet built
- Only the **linux-x64** CLI binary is hosted (ubuntu runners are fine; macOS /
  arm64 would 404 until built with `bun script/build.ts` for those targets).
- The **OIDC broker** `api.ottili.one/coder` is down; the workflow above avoids
  it via `use_github_token: "true"`.
