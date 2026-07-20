import { createHighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"
import bash from "@shikijs/langs/bash"
import css from "@shikijs/langs/css"
import html from "@shikijs/langs/html"
import javascript from "@shikijs/langs/javascript"
import json from "@shikijs/langs/json"
import jsx from "@shikijs/langs/jsx"
import lua from "@shikijs/langs/lua"
import luau from "@shikijs/langs/luau"
import tsx from "@shikijs/langs/tsx"
import typescript from "@shikijs/langs/typescript"
import githubLight from "@shikijs/themes/github-light"

const languageAliases: Record<string, string> = {
  bash: "bash",
  css: "css",
  html: "html",
  js: "javascript",
  javascript: "javascript",
  json: "json",
  jsx: "jsx",
  lua: "lua",
  luau: "luau",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
}

const highlighter = createHighlighterCore({
  themes: [githubLight],
  langs: [
    bash,
    css,
    html,
    javascript,
    json,
    jsx,
    lua,
    luau,
    tsx,
    typescript,
  ],
  engine: createJavaScriptRegexEngine(),
})

export async function highlightCode(code: string, language: string) {
  const normalized = languageAliases[language.toLowerCase()]
  if (!normalized) return null

  return (await highlighter).codeToHtml(code, {
    lang: normalized,
    theme: "github-light",
  })
}
