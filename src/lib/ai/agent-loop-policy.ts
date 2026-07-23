export const MAX_AGENT_ITERATIONS = 30
export const REPEATED_FAILURE_ITERATIONS = 3

interface AgentLoopToolResult {
  output: unknown
}

export interface AgentLoopStep {
  toolResults: readonly AgentLoopToolResult[]
}

function toolFailureMessage(output: unknown) {
  if (!output || typeof output !== "object" || !("error" in output)) {
    return null
  }
  const error = output.error
  if (typeof error === "string" && error) return error
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message
  }
  return error ? String(error) : null
}

function failedStepSignature(step: AgentLoopStep) {
  if (step.toolResults.length === 0) return null
  const messages = step.toolResults.map((result) =>
    toolFailureMessage(result.output)
  )
  if (messages.some((message) => message === null)) return null
  return (messages as string[]).sort().join("\n")
}

export function getAgentLoopStopReason(
  steps: readonly AgentLoopStep[],
) {
  if (steps.length >= MAX_AGENT_ITERATIONS) {
    return `Agent stopped after ${MAX_AGENT_ITERATIONS} steps to prevent an unsafe loop`
  }

  const recent = steps.slice(-REPEATED_FAILURE_ITERATIONS)
  if (recent.length < REPEATED_FAILURE_ITERATIONS) return null
  const signatures = recent.map(failedStepSignature)
  const repeated = signatures[0]
  if (!repeated || signatures.some((signature) => signature !== repeated)) {
    return null
  }

  const lastError = repeated.split("\n")[0].slice(0, 500)
  return `Agent stopped after repeating the same failed tool step ${REPEATED_FAILURE_ITERATIONS} times. Last error: ${lastError}`
}
