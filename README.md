---
translations:
  zh-CN: README.zh-CN.md
---
# NewAPI Empty Retry

A New API provider plugin that turns empty upstream JSON or SSE responses into HTTP `400 empty_upstream_response`, so New API can retry another eligible channel after `400` is added to its automatic retry status ranges.

## Why this is a provider plugin

New API request-processing plugins (`reply` / `reject`) stop with HTTP 400 marked `SkipRetry`. Adding `400` to the retry ranges does not override that flag.

A type-61 provider converter error has no `SkipRetry` flag. Its HTTP status goes through New API's normal retry policy. This plugin therefore returns a converter error with status `400`, allowing the administrator to include `400` in the automatic retry status ranges and trigger channel retry.

## Install

Install `plugin.js` through the New API plugin manager:

```text
https://raw.githubusercontent.com/NKBaa/newapi-empty-retry-plugin/main/plugin.js
```

Plugin key:

```text
newapi-empty-retry
```

## Required New API setting

In the New API administration settings, add `400` to the automatic retry status-code ranges.

Recommended range addition:

```text
400
```

Keep the existing ranges. For example, if the current setting is:

```text
409-499,500-503,505-523,525-599
```

change it to include `400`:

```text
400,409-499,500-503,505-523,525-599
```

Without this setting, the client receives `400` but New API will not retry another channel.

## Channel setup

Create a type-61 plugin channel bound to `newapi-empty-retry`:

| Field | Value |
| --- | --- |
| Base URL | Upstream New API / One API root, for example `https://upstream.example.com` |
| Key | Upstream API key |
| Model list | The upstream model IDs clients should call |

Declared relay routes:

- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`
- Gemini `generateContent` and `streamGenerateContent`

## Empty-response error

When an upstream 2xx response contains no assistant output, the plugin returns:

```json
{
  "error": {
    "status": 400,
    "type": "invalid_request_error",
    "code": "empty_upstream_response",
    "message": "Upstream returned an empty response; mapped to retryable HTTP 400 empty_upstream_response"
  }
}
```

New API can then retry according to its retry budget, model routing and channel-affinity rules.

## What counts as empty

Non-stream responses:

- empty body;
- whitespace-only body;
- `{}`;
- empty `choices`;
- assistant content that is empty or whitespace-only;
- only role, finish reason or usage, with no text, reasoning or tool call.

Streaming responses:

- all events before the first useful output are buffered;
- when text, reasoning, tool calls or another supported output arrives, buffered events are released unchanged;
- if the stream ends without any useful output, no client event has been released and the plugin returns HTTP `400`;
- if more than 64 events or 32768 serialized characters are buffered before the first useful output, the plugin returns a separate HTTP `502 empty_response_buffer_exceeded`, which follows the 5xx retry policy instead of being reported as empty;
- New API stream keepalive may send a PING before the first useful output and commit HTTP 200. Internal retries can still continue, but an exhausted retry budget may end an already-open stream instead of returning 400 to the client. Disable the relevant keepalive or Ping when the client must receive the 400 status.

Upstream non-2xx responses keep their original status and message.

## Supported output signals

- OpenAI Chat Completions `message` and `delta`;
- OpenAI Responses text, function calls, nested `output` / `output_item`, completed-response output and reasoning summaries;
- Anthropic Messages text, thinking and tool blocks;
- Gemini candidate text, function calls and inline data;
- legacy `choices[].text`.

## Validation

Validated with the official `new-api` CLI from `v1.0.0-rc.51`:

```sh
new-api plugin lint plugin.js
new-api plugin test plugin.js --fixture tests/fixture.json
```

The fixture covers empty JSON, normal JSON, buffered role events, first content release, empty stream termination, the Gemini streaming endpoint and nested Responses tool calls.

## Limits

- The plugin does not inspect embeddings, image, audio or binary responses.
- A stream is delayed until its first useful output because events are held to guarantee a pre-stream `400`. If New API sends a keepalive PING during that wait, the client may already have an HTTP 200 response.
- Non-JSON stream data is treated as non-empty and passed through.
- This plugin changes only the provider channel's error status; retry still requires `400` in the retry ranges and another eligible channel.
