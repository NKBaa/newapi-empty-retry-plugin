# Changelog

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
