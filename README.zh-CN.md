---
locale: zh-CN
---
# NewAPI 空回 404

一个 New API 供应商插件：把上游空的 JSON 或 SSE 回复转换成 HTTP `404 model_not_found`，从而让 New API 尝试重试其它可用渠道。

## 为什么是供应商插件

New API 的请求处理插件通过 `reply` / `reject` 停止回答时，最终状态固定为 HTTP 400；而 400 默认不可重试。因此这个插件使用 type-61 供应商渠道和 `converter: "plugin"` 钩子，这类钩子可以返回自定义错误状态。

New API 默认自动重试状态范围包含 `409-499`，所以 `404` 会触发重试；除非管理员修改了重试范围，或渠道亲和/严格会话规则禁止重试。

## 安装

通过 New API 插件管理器安装 `plugin.js`，或安装本仓库对应版本。

插件 key：

```text
newapi-empty-404
```

## 渠道设置

新建一个绑定 `newapi-empty-404` 的 type-61 插件渠道：

| 字段 | 值 |
| --- | --- |
| Base URL | 上游 New API / One API 根地址，例如 `https://upstream.example.com` |
| 密钥 | 上游 API Key |
| 模型 | 客户端要调用的上游模型 ID |

插件声明以下转发路由：

- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`
- Gemini `generateContent` 和 `streamGenerateContent`

Base URL 指向真正需要做空回检测的上游。它可以是另一个 New API 实例，也可以是任意 OpenAI 兼容服务。

## 重试行为

上游返回 2xx，但没有任何助手输出时，插件返回：

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

New API 随后可以按自身重试策略换渠道重试。

以下情况不保证重试：

- 请求重试次数已经用完；
- 该模型只有一个渠道；
- 渠道亲和或严格会话规则禁止重试；
- 管理员修改了自动重试状态范围，排除了 `404`。

如果自定义了重试范围，请加入 `404`。

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
- 如果流结束仍没有有效输出，因为客户端尚未收到任何事件，可以直接返回 `404`。

上游非 2xx 响应保留原状态码和错误信息。

## 支持的输出信号

空回检测识别：

- OpenAI Chat Completions 的 `message` 和 `delta`；
- OpenAI Responses 的文本和函数调用；
- Anthropic Messages 的文本、thinking 和工具块；
- Gemini candidate 的文本、函数调用和内联数据；
- 旧式 `choices[].text`。

## 验证

已使用 `v1.0.0-rc.51` 的官方 `new-api` CLI 验证：

```sh
new-api plugin lint plugin.js
new-api plugin test plugin.js --fixture tests/fixture.json
```

fixture 覆盖空 JSON、正常 JSON、role 事件缓冲、首个内容事件释放和空流终止。

## 限制

- 不检查 embeddings、图片、音频或二进制响应。
- 为保证流式空回也能在发送首个事件前返回 `404`，流会等待到第一个有效输出才开始释放。
- 非 JSON 的流事件按非空处理并原样透传。
- 插件不修改 New API 核心重试策略，只负责产生可重试的 `404`。

