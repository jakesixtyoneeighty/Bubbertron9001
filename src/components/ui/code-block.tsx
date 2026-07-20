import { cn } from "@/lib/utils"
import React, { useEffect, useState } from "react"

let highlighterModule:
  | Promise<typeof import("@/lib/highlighter")>
  | undefined

function loadHighlighter() {
  highlighterModule ??= import("@/lib/highlighter")
  return highlighterModule
}

export type CodeBlockProps = {
  children?: React.ReactNode
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        "not-prose flex w-full flex-col overflow-clip border",
        "border-border bg-card text-card-foreground rounded-xl",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export type CodeBlockCodeProps = {
  code: string
  language?: string
  theme?: string
  className?: string
} & React.HTMLProps<HTMLDivElement>

function CodeBlockCode({
  code,
  language = "tsx",
  theme = "github-light",
  className,
  ...props
}: CodeBlockCodeProps) {
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setHighlightedHtml(null)

    async function highlight() {
      if (!code) {
        if (!cancelled) {
          setHighlightedHtml("<pre><code></code></pre>")
        }
        return
      }

      try {
        const { highlightCode } = await loadHighlighter()
        const html = await highlightCode(code, language)
        if (!cancelled && html) {
          setHighlightedHtml(html)
        }
      } catch (error) {
        console.warn("[CodeBlock] Syntax highlighting failed; using plain code.", error)
      }
    }

    void highlight()
    return () => {
      cancelled = true
    }
  }, [code, language, theme])

  const classNames = cn(
    "w-full overflow-x-auto text-[13px] [&>pre]:px-4 [&>pre]:py-4",
    className
  )

  // SSR fallback: render plain code if not hydrated yet
  return highlightedHtml ? (
    <div
      className={classNames}
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      {...props}
    />
  ) : (
    <div className={classNames} {...props}>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>

function CodeBlockGroup({
  children,
  className,
  ...props
}: CodeBlockGroupProps) {
  return (
    <div
      className={cn("flex items-center justify-between", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export { CodeBlockGroup, CodeBlockCode, CodeBlock }
