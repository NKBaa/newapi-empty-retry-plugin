---
translations:
  zh-CN: README.zh-CN.md
---
# NewAPI Empty 404

A New API provider plugin that turns empty upstream JSON or SSE responses into HTTP `404 model_not_found`, so New API can retry another eligible channel.

## Why this is a provider plugin

New API request-processing plugins (`reply` / `reject`) always map a stopped response to HTTP 400. HTTP 400 is normally non-retryable. This plugin therefore uses a type-61 provider channel and the `converter: "plugin"` hooks, which may return an arbitrary converter error status.

New API's default automatic retry ranges include `409-499`, so `404` is retryable unless an administrator has changed the retry ranges or a channel-affinity rule suppresses retries.

## Install

Install `plugin.js` through the New API plugin manager:

```text
https://raw.githubusercontent.com/NKBaa/newapi-empty-404-plugin/main/plugin.js
```

Plugin key:

```text
newapi-empty-404
```

## Channel setup

Create a type-61 plugin channel bound to `newapi-empty-404`:

| Field | Value |
| --- | --- |
| Base URL | Upstream New API / One API root, for example `https://upstream.example.com` |
| Key | Upstream API key |
| Model list | The upstream model IDs clients should call |

The plugin declares these relay routes:

- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`
- Gemini `generateContent` and `streamGenerateContent`

The upstream Base URL is the server that actually needs the empty-response guard. The plugin can wrap another New API instance or another OpenAI-compatible service.

## Retry behavior

When the upstream returns a 2xx response that contains no assistant output, the plugin returns:

```json
{
  "error": {
    "status": 404,
    "type": "invalid_request_error",
    "code": "model_not_found",
    "message": "Upstream returned an empty response; mapped to 404 model_not_found"
  }
}
```

New API can then retry the request on another channel for the model.

Retry is not guaranteed when:

- the request has exhausted its retry budget;
- model routing has only one channel;
- a channel-affinity or strict-session rule suppresses retry;
- the administrator changed the automatic retry status ranges and excluded `404`.

If you customize retry ranges, include `404`.

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
- when text, reasoning, tool calls or another supported output arrives, the buffered events are released unchanged;
- if the stream ends without any useful output, no client event has been released and the plugin returns `404`.

Non-2xx upstream responses keep their original status and message.

## Supported output signals

The empty check recognizes:

- OpenAI Chat Completions `message` and `delta`;
- OpenAI Responses text and function-call output;
- Anthropic Messages text, thinking and tool blocks;
- Gemini candidate text, function calls and inline data;
- legacy `choices[].text`.

## Validation

Validated with the official `new-api` CLI from `v1.0.0-rc.51`:

```sh
new-api plugin lint plugin.js
new-api plugin test plugin.js --fixture tests/fixture.json
```

The fixture suite checks empty JSON, non-empty JSON, buffered role events, first content release and empty stream termination.

## Limits

- The plugin does not inspect embeddings, image, audio or binary responses.
- A stream is delayed until its first useful output because events are held to guarantee a pre-stream `404`.
- Non-JSON stream data is treated as non-empty and passed through.
- This plugin does not change New API core retry policy; it only supplies a retryable `404`.


