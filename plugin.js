export const meta = {
  apiVersion: 1,
  key: "newapi-empty-retry",
  name: "NewAPI Empty Retry",
  version: "1.1.0",
  author: { name: "NKBaa" },
  description: {
    en: "Relay an upstream New API / One API channel and turn empty JSON or SSE answers into retryable HTTP 400 empty_upstream_response.",
    zh: "作为 NewAPI 上游通道转发请求，并把空 JSON 或空 SSE 回复转换为可配置重试的 HTTP 400 empty_upstream_response。",
  },
  relay: [
    { incoming_path: "/v1/chat/completions", upstream_path: "/v1/chat/completions", converter: "plugin" },
    { incoming_path: "/v1/responses", upstream_path: "/v1/responses", converter: "plugin" },
    { incoming_path: "/v1/messages", upstream_path: "/v1/messages", converter: "plugin" },
    { incoming_path: "/v1beta/models/{model}:generateContent", upstream_path: "/v1beta/models/{model}:generateContent", converter: "plugin" },
  ],
}

const EMPTY_ERROR = {
  status: 400,
  type: "invalid_request_error",
  code: "empty_upstream_response",
  message: "Upstream returned an empty response; mapped to retryable HTTP 400 empty_upstream_response",
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0
}

function meaningfulPart(part) {
  if (part == null) return false
  if (typeof part === "string") return text(part)
  if (typeof part !== "object") return false
  if (text(part.text) || text(part.content) || text(part.refusal)) return true
  if (text(part.reasoning_content) || text(part.reasoning) || text(part.thinking)) return true
  if (part.type === "tool_use" || part.type === "tool_result" || part.type === "function_call") return true
  if (part.function_call || part.functionCall || part.tool_calls?.length) return true
  if (part.type === "image" || part.type === "image_url" || part.type === "input_image") {
    return !!(part.image_url || part.source || part.data)
  }
  return !!(part.name && part.arguments)
}

function meaningfulContent(content) {
  if (text(content)) return true
  if (Array.isArray(content)) return content.some(meaningfulPart)
  return meaningfulPart(content)
}

function meaningfulMessage(message) {
  if (!message || typeof message !== "object") return false
  return meaningfulContent(message.content)
    || message.tool_calls?.length > 0
    || !!message.function_call
    || text(message.reasoning_content)
    || text(message.reasoning)
    || text(message.thinking)
    || text(message.refusal)
}

function meaningfulJson(value) {
  if (value == null) return false
  if (typeof value === "string") return text(value)
  if (typeof value !== "object") return true
  if (value.error || value.type === "error" || value.type === "error_event") return true

  if (Array.isArray(value.choices)) {
    for (const choice of value.choices) {
      if (text(choice?.text)) return true
      if (meaningfulMessage(choice?.message) || meaningfulMessage(choice?.delta)) return true
      if (meaningfulContent(choice?.content)) return true
    }
  }

  if (text(value.output_text)) return true
  if (Array.isArray(value.output)) {
    for (const item of value.output) {
      if (!item || typeof item !== "object") continue
      if (["function_call", "computer_call", "web_search_call", "tool_call"].includes(item.type)) return true
      if (item.arguments || item.function_call) return true
      if (meaningfulContent(item.content)) return true
    }
  }

  if (Array.isArray(value.content) && meaningfulContent(value.content)) return true
  if (meaningfulMessage(value.delta)) return true
  if (meaningfulPart(value.delta) || meaningfulPart(value.content_block)) return true

  if (Array.isArray(value.candidates)) {
    for (const candidate of value.candidates) {
      const parts = candidate?.content?.parts
      if (!Array.isArray(parts)) continue
      for (const part of parts) {
        if (meaningfulPart(part) || part?.functionCall || part?.inlineData || part?.inline_data) return true
      }
    }
  }

  if (text(value.delta) && ["response.output_text.delta", "response.function_call_arguments.delta"].includes(value.type)) return true
  if (Array.isArray(value.parts) && value.parts.some((part) => meaningfulPart(part) || part?.functionCall || part?.inlineData)) return true
  return false
}

function meaningfulData(data, eventName) {
  if (eventName === "error") return true
  if (typeof data !== "string" || !data.trim() || data.trim() === "[DONE]") return false
  try {
    return meaningfulJson(JSON.parse(data))
  } catch {
    return true
  }
}

function eventOf(input) {
  const event = {}
  if (input.event !== undefined) event.event = input.event
  if (input.data !== undefined) event.data = input.data
  return event
}

function stateOf(value) {
  if (!value || typeof value !== "object") return { seen: false, pending: [] }
  return {
    seen: value.seen === true,
    pending: Array.isArray(value.pending) ? value.pending : [],
  }
}

function contentTypeOf(response) {
  return response.headers?.["content-type"] || response.headers?.["Content-Type"] || "application/json"
}

function messageOf(body) {
  if (!body) return "Upstream returned an error"
  try {
    const parsed = JSON.parse(body)
    return String(parsed?.error?.message || parsed?.message || body).slice(0, 2000)
  } catch {
    return String(body).slice(0, 2000)
  }
}

function upstreamError(response) {
  const status = response.status >= 400 && response.status <= 599 ? response.status : 502
  let type = "upstream_error"
  let code = "upstream_error"
  try {
    const parsed = JSON.parse(response.body)
    if (typeof parsed?.error?.type === "string") type = parsed.error.type
    if (typeof parsed?.error?.code === "string") code = parsed.error.code
  } catch {}
  return { error: { status, type, code, message: messageOf(response.body) } }
}

export function convertRequest(_ctx, request) {
  if (request.form) {
    return { form: request.form, stream: request.stream, state: { seen: false, pending: [] } }
  }
  return {
    body: request.body,
    contentType: "application/json",
    stream: request.stream,
    state: { seen: false, pending: [] },
  }
}

export function convertResponse(_ctx, response) {
  if (response.status < 200 || response.status >= 300) return upstreamError(response)
  const body = typeof response.body === "string" ? response.body : String(response.body ?? "")
  if (!body.trim()) return { error: EMPTY_ERROR }

  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    return { body, contentType: contentTypeOf(response) }
  }
  if (!meaningfulJson(parsed)) return { error: EMPTY_ERROR }
  return { body, contentType: contentTypeOf(response) }
}

export function convertStreamEvent(ctx, input) {
  const state = stateOf(ctx?.state)

  if (input.done) {
    if (!state.seen) return { error: EMPTY_ERROR }
    return { state }
  }

  if (input.data === "[DONE]") return { state }

  if (state.seen) {
    return { events: [eventOf(input)], state }
  }

  if (meaningfulData(input.data, input.event)) {
    const events = [...state.pending, eventOf(input)]
    return { events, state: { seen: true, pending: [] } }
  }

  const pending = [...state.pending, eventOf(input)]
  const next = { seen: false, pending }
  if (pending.length > 64 || JSON.stringify(pending).length > 32768) {
    return { error: EMPTY_ERROR }
  }
  return { state: next }
}





