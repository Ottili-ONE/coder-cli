#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publishPackage(targetDir: string, name: string, version: string) {
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(targetDir)
  if (await published(name, version)) {
    console.log(`already published ${name}@${version}`)
    return
  }
  await $`rm -f *.tgz .npmrc.publish`.cwd(targetDir).nothrow()
  await $`bun pm pack`.cwd(targetDir)
  const npmrcPath = "/tmp/ottili-coder-npmrc.publish"
  await Bun.write(npmrcPath, `//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`)
  process.env.NPM_CONFIG_USERCONFIG = npmrcPath
  await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(targetDir)
  console.log(`published ${name}@${version}`)
}

const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const distPkg = await Bun.file(`./dist/${filepath}`).json()
  if (distPkg.name === pkg.name) continue
  binaries[distPkg.name] = distPkg.version
}

const version = Object.values(binaries)[0]
if (!version) throw new Error("No platform binaries found in dist/")

await $`mkdir -p ./dist/${pkg.name}`
await $`mkdir -p ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
await $`cp ./README.npm.md ./dist/${pkg.name}/README.md`
await Bun.file(`./dist/${pkg.name}/LICENSE`).write(await Bun.file("../../LICENSE").text())
await Bun.file(`./dist/${pkg.name}/bin/${pkg.name}.exe`).write(
  [
    "#!/usr/bin/env sh",
    `echo "Error: ${pkg.name}'s postinstall script was not run." >&2`,
    "exit 1",
    "",
  ].join("\n"),
)
await $`chmod 755 ./dist/${pkg.name}/bin/${pkg.name}.exe`

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name,
      bin: { [pkg.name]: `./bin/${pkg.name}.exe` },
      description: "Ottili ONE Coder — autonomous AI coding agent for the terminal",
      homepage: "https://ottili.one/coder",
      repository: {
        type: "git",
        url: "git+https://github.com/Ottili-ONE/coder-cli.git",
      },
      version,
      optionalDependencies: binaries,
      scripts: { postinstall: "node postinstall.mjs" },
    },
    null,
    2,
  ),
)

for (const [name] of Object.entries(binaries)) {
  try {
    await publishPackage(`./dist/${name}`, name, binaries[name])
  } catch (error) {
    console.error(`failed to publish ${name}@${binaries[name]}`, error)
  }
}
await publishPackage(`./dist/${pkg.name}`, pkg.name, version)
