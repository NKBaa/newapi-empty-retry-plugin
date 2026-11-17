---
locale: zh-CN
---
# NewAPI 空回重试

一个 New API 供应商插件：把上游空的 JSON 或 SSE 回复转换成 HTTP `400 empty_upstream_response`，在自动重试状态码加入 `400` 后，让 New API 重试其它可用渠道。

## 为什么是供应商插件

New API 请求处理插件通过 `reply` / `reject` 停止响应时，会生成 HTTP 400 并强制标记 `SkipRetry`。即使把 400 加入自动重试范围，也不会覆盖这个标记。

type-61 供应商 converter 返回的错误没有 `SkipRetry` 标记，其 HTTP 状态会进入 New API 正常重试判定。所以本插件返回状态 `400`，管理员把 `400` 加入自动重试状态码后即可换渠道重试。

## 安装

通过 New API 插件管理器安装 `plugin.js`：

```text
https://raw.githubusercontent.com/NKBaa/newapi-empty-retry-plugin/main/plugin.js
```

插件 key：

```text
newapi-empty-retry
```

## 必须修改的 New API 设置

在 New API 管理后台的自动重试状态码范围中加入 `400`。

建议只增加该项，保留现有范围。例如当前为：

```text
409-499,500-503,505-523,525-599
```

修改为：

```text
400,409-499,500-503,505-523,525-599
```

如果不加入 `400`，客户端会收到 400，但 New API 不会换渠道重试。

## 渠道设置

新建一个绑定 `newapi-empty-retry` 的 type-61 插件渠道：

| 字段 | 值 |
| --- | --- |
| Base URL | 上游 New API / One API 根地址，例如 `https://upstream.example.com` |
| 密钥 | 上游 API Key |
| 模型 | 客户端要调用的上游模型 ID |

插件声明以下路由：

- `POST /v1/chat/completions`
- `POST /v1/completions`
- `POST /v1/responses`
- `POST /v1/messages`
- `POST /v1/models/{model}:generateContent`
- `POST /v1beta/models/{model}:generateContent`

## 空回错误

上游返回 2xx，但没有任何助手输出时，插件返回：

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

New API 随后根据重试次数、模型路由和渠道亲和规则决定是否换渠道。

## 什么情况算空回

非流式：

- 空 body；
- 只有空白字符；
- `{}`；
- `choices` 为空；
- 助手 content 为空或只有空白；
- 只有 role、finish_reason 或 usage，没有文本、思考或工具调用。

流式：

- 首个有效输出前的所有事件先被插件缓冲；
- 出现文本、思考或工具调用后，把缓冲事件原样释放给客户端；
- 如果流结束仍没有有效输出，因为客户端尚未收到任何事件，可以直接返回 HTTP `400`。
- 如果首个有效输出前缓冲超过 64 个事件或 32768 个序列化字符，返回独立的 HTTP `502 empty_response_buffer_exceeded`，沿 5xx 重试，不再误报为空回。
- NewAPI 的流式保活可能在首个有效输出前发送 PING 并提交 HTTP 200。此时插件仍可触发内部换渠道重试，但重试耗尽后客户端看到的是已打开的流，不一定能收到 400。若客户端必须收到 400，应关闭相应流式保活或禁用该渠道的 Ping。

上游非 2xx 响应保留原状态码和错误信息。

## 支持的输出信号

- OpenAI Chat Completions 的 `message` 和 `delta`；
- OpenAI Responses 的文本、函数调用、嵌套 `output` / `output_item`、完成事件和 reasoning summary；
- Anthropic Messages 的文本、thinking 和工具块；
- Gemini candidate 的文本、函数调用和内联数据；
- 旧式 `choices[].text`。

## 验证

已使用 `v1.0.0-rc.51` 的官方 `new-api` CLI 验证：

```sh
new-api plugin lint plugin.js
new-api plugin test plugin.js --fixture tests/fixture.json
```

fixture 覆盖空 JSON、正常 JSON、role 事件缓冲、首个内容事件释放、空流终止、Gemini 流式地址和 Responses 嵌套工具调用。

## 限制

- 不检查 embeddings、图片、音频或二进制响应。
- 为保证流式空回也能在发送首个事件前返回 `400`，流会等待到第一个有效输出才开始释放。若 NewAPI 在该等待期已经发送保活 PING，客户端响应状态可能已是 200。
- 非 JSON 的流事件按非空处理并原样透传。
- 插件只负责把空回变成可重试的 400；还需要在自动重试范围加入 400，并且存在其它可用渠道。
