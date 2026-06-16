const logo = {
  left: [
    ` █▀▀█ ▀▀█▀▀ ▀▀█▀▀ ▀█▀ █     ▀█▀ `,
    ` █  █   █     █    █  █      █  `,
    ` █  █   █     █    █  █      █  `,
    ` ▀▀▀▀   ▀     ▀   ▀▀▀ ▀▀▀▀  ▀▀▀ `,
    ``,
    `    █▀▀▀ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ `,
    `    █    █  █ █  █ █▀▀  █▀▀▄ `,
    `    █    █  █ █  █ █    █  █ `,
    `    ▀▀▀▀ ▀▀▀▀ ▀▀▀  ▀▀▀▀ ▀  ▀ `,
  ],
  right: ["", "", "", "", "", "", "", "", ""],
}

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"

function wordmark(pad = "") {
  const draw = (line: string, fg: string, shadow: string, bg: string) =>
    [...line]
      .map((char) => {
        if (char === "_") return `${bg} ${reset}`
        if (char === "^") return `${fg}${bg}▀${reset}`
        if (char === "~") return `${shadow}▀${reset}`
        if (char === " ") return " "
        return `${fg}${char}${reset}`
      })
      .join("")

  return logo.left.map((line) => {
    const left = draw(line, dim, "\x1b[38;5;235m", "\x1b[48;5;235m")
    return `${pad}${left}`
  })
}

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...wordmark("  "),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}ottili-coder -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}
