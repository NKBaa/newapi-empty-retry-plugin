# Changelog

## [1.3.0] - 2026-11-17

### Fixed

- Support extracting Gemini stream path from `ctx.path` (New API production hook context) as well as `request.path`.
- Forward `data: [DONE]` to clients on active streams while continuing to suppress it during empty streams.
- Ensure buffered stream events always populate the `data` member to satisfy New API plugin stream event decoding.
- Detect Anthropic streaming tool deltas (`partial_json`) and Gemini reasoning thoughts (`thought`).
- Add `/v1/completions` and `/v1/models/{model}:generateContent` to declared relay routes.
- Safely forward upstream binary responses without misclassifying them as empty.

## [1.2.0] - 2026-11-17

### Fixed

- Route Gemini streaming requests to `streamGenerateContent?alt=sse`.
- Recognize nested OpenAI Responses output items, completed responses and reasoning summaries.
- Return a separate retryable `502 empty_response_buffer_exceeded` error when metadata buffering exceeds its limit.
- Document New API stream keepalive behavior before the first useful output.

## [1.1.0] - 2026-11-17

### Changed

- Empty upstream responses now return HTTP `400 empty_upstream_response`.
- The plugin key is now `newapi-empty-retry`.
- Retry requires adding `400` to New API's automatic retry status ranges.
- Documented why request-processing `reply.stop` cannot trigger retry.

## [1.0.0] - 2026-11-17

### Added

- New API type-61 provider plugin for empty-response detection.
- OpenAI Chat Completions, Responses, Anthropic Messages and Gemini routes.
