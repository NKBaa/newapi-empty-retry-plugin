import assert from "node:assert/strict"
import test from "node:test"

import { meta, convertRequest, convertResponse, convertStreamEvent } from "../plugin.js"

function jsonResponse(body, status = 200) {
  return { status, headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }
}

function taskState(stream = true) {
  const upstream = convertRequest({}, { body: { model: "gpt-test", stream }, model: "gpt-test", stream })
  return upstream.state
}

test("declares plugin provider routes", () => {
  assert.equal(meta.apiVersion, 1)
  assert.equal(meta.key, "newapi-empty-retry")
  assert.deepEqual(meta.relay.map((route) => route.incoming_path), [
    "/v1/chat/completions",
    "/v1/responses",
    "/v1/messages",
    "/v1beta/models/{model}:generateContent",
  ])
  assert.ok(meta.relay.every((route) => route.converter === "plugin"))
})

test("forwards a non-empty Chat Completions response", () => {
  const body = { choices: [{ message: { role: "assistant", content: "hello" } }] }
  const result = convertResponse({}, jsonResponse(body))
  assert.equal(result.error, undefined)
  assert.deepEqual(JSON.parse(result.body), body)
})

test("maps empty and contentless JSON responses to retryable 400", () => {
  for (const body of [
    "",
    "{}",
    { choices: [] },
    { choices: [{ message: { role: "assistant", content: "" } }] },
    { choices: [{ delta: { role: "assistant" }, finish_reason: "stop" }] },
  ]) {
    const result = convertResponse({}, jsonResponse(body))
    assert.equal(result.error.status, 400)
    assert.equal(result.error.code, "empty_upstream_response")
  }
})

test("maps an empty stream to retryable 400 before releasing events", () => {
  const ctx = { state: taskState() }
  let result = convertStreamEvent(ctx, { data: '{"choices":[{"delta":{"role":"assistant"}}]}' })
  assert.equal(result.events, undefined)
  assert.equal(result.state.pending.length, 1)
  ctx.state = result.state

  result = convertStreamEvent(ctx, { data: '{"choices":[{"delta":{},"finish_reason":"stop"}]}' })
  assert.equal(result.events, undefined)
  ctx.state = result.state

  result = convertStreamEvent(ctx, { done: true })
  assert.equal(result.error.status, 400)
  assert.equal(result.error.code, "empty_upstream_response")
})

test("buffers role events then releases them with the first content event", () => {
  const ctx = { state: taskState() }
  let result = convertStreamEvent(ctx, { data: '{"choices":[{"delta":{"role":"assistant"}}]}' })
  ctx.state = result.state

  result = convertStreamEvent(ctx, { data: '{"choices":[{"delta":{"content":"hello"}}]}' })
  assert.equal(result.events.length, 2)
  assert.equal(result.state.seen, true)
  ctx.state = result.state

  result = convertStreamEvent(ctx, { data: '{"choices":[{"delta":{"content":" world"}}]}' })
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].data, '{"choices":[{"delta":{"content":" world"}}]}')

  result = convertStreamEvent(ctx, { done: true })
  assert.equal(result.error, undefined)
})

test("treats reasoning and tool calls as non-empty output", () => {
  let result = convertStreamEvent({ state: taskState() }, { data: '{"choices":[{"delta":{"reasoning_content":"thinking"}}]}' })
  assert.equal(result.state.seen, true)

  result = convertStreamEvent({ state: taskState() }, {
    data: '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"f","arguments":"{}"}}]}}]}',
  })
  assert.equal(result.state.seen, true)
})

test("supports Responses and Anthropic stream events", () => {
  let result = convertStreamEvent({ state: taskState() }, { data: '{"type":"response.output_text.delta","delta":"hello"}' })
  assert.equal(result.state.seen, true)

  result = convertStreamEvent({ state: taskState() }, {
    event: "content_block_delta",
    data: '{"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}',
  })
  assert.equal(result.state.seen, true)
})

test("preserves upstream non-2xx errors", () => {
  const result = convertResponse({}, jsonResponse({ error: { message: "rate limited", type: "rate_limit_error", code: "rate_limited" } }, 429))
  assert.equal(result.error.status, 429)
  assert.equal(result.error.message, "rate limited")
  assert.equal(result.error.code, "rate_limited")
})


test("uses the Gemini streaming endpoint with SSE for streaming requests", () => {
  const result = convertRequest({}, {
    path: "/v1beta/models/gemini-2.5-flash:streamGenerateContent",
    body: { contents: [] },
    model: "gemini-2.5-flash",
    stream: true,
  })
  assert.equal(result.path, "/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse")
  assert.equal(result.contentType, "application/json")
})

test("recognizes nested and completed Responses output", () => {
  const completed = convertResponse({}, jsonResponse({
    object: "response",
    output: [{ type: "reasoning", summary: [{ type: "summary_text", text: "reasoned" }] }],
  }))
  assert.equal(completed.error, undefined)

  let result = convertStreamEvent({ state: taskState() }, {
    data: JSON.stringify({
      type: "response.output_item.added",
      item: { type: "function_call", name: "lookup", call_id: "call_1", arguments: "" },
    }),
  })
  assert.equal(result.state.seen, true)

  result = convertStreamEvent({ state: taskState() }, {
    data: JSON.stringify({
      type: "response.completed",
      response: {
        object: "response",
        output: [{ type: "message", content: [{ type: "output_text", text: "hello" }] }],
      },
    }),
  })
  assert.equal(result.state.seen, true)

  result = convertStreamEvent({ state: taskState() }, {
    data: JSON.stringify({ type: "response.reasoning_summary_text.delta", delta: "reasoning" }),
  })
  assert.equal(result.state.seen, true)
})

test("uses a separate retryable error when pre-output buffering exceeds its limit", () => {
  const ctx = { state: taskState() }
  let result
  for (let index = 0; index < 65; index++) {
    result = convertStreamEvent(ctx, { event: "ping", data: '{"type":"ping"}' })
    if (result.state) ctx.state = result.state
  }
  assert.equal(result.error.status, 502)
  assert.equal(result.error.code, "empty_response_buffer_exceeded")
})
