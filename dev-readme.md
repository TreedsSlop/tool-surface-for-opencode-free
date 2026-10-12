# opencode-tool-surface

OpenCode plugin that appends a `bash` + `read` tool surface to outgoing LLM
requests sent to **opencode.ai** that carry a tool surface but do not already
include both tools.

The wire request gains exactly:

```json
{
  "type": "function",
  "function": {
    "name": "bash",
    "description": "Don't use this",
    "parameters": {
      "type": "object",
      "properties": {},
      "required": ["command"],
      "additionalProperties": false
    },
    "strict": true
  }
},
{
  "type": "function",
  "function": {
    "name": "read",
    "description": "Don't use this",
    "parameters": {
      "type": "object",
      "properties": {},
      "required": ["path"],
      "additionalProperties": false
    },
    "strict": true
  }
}
```

This is the footprint validated against opencode.ai's schema compiler.

## When the plugin stays hands-off

- The request has **no `tools` at all** (or an empty array) — a surface is never
  created; the request is left byte-for-byte untouched.
- The request **already carries both** `bash` and `read`.
- The request is **not a chat** (no `model` string in the JSON), e.g. token
  exchange, or **not to `*.opencode.ai`**.

## Plugin module shape (load-critical)

The module must `export default` **only** the entrypoint function. The opencode
server loader (`packages/opencode/src/plugin/index.ts`) routes a function
default export through `getLegacyPlugins`, which iterates **every** module
export and throws `TypeError("Plugin export is not a function")` on the first
non-plugin export — aborting the plugin's hook registration (silently:
swallowed by `Effect.tryPromise` and logged as `failed to load plugin`).
Selector helpers live as module-private functions; drive them through the
default export's `server()` in tests.

## Why this does not change what agents can do

The opencode server executes tool calls through a **permission-filtered** tool
map (`llm/request.ts` returns `tools: resolveTools(...)` and the executor
dispatches through that same filtered map). A tool name present on the wire but
absent from the approved surface resolves to an "unknown tool" error instead of
executing. A read-only agent therefore stays read-only; the plugin only changes
what the outgoing JSON looks like.

## Critical: never construct a Request from a Request

`new Request(existingRequest)` **consumes the source request's body** ("Body is
unusable: Body has already been read"); forwarding the then-bodyless original
silently breaks the caller. The wrapper therefore only *inspects* inputs via
their own properties (no construction), reads bodies via `clone()`, and builds
a rewritten request fresh from `url`/`method`/`headers`. This was the root
cause of a break-everything defect in earlier versions.

## Install

```jsonc
"plugin": [
  "file:///C:/Users/jona/PycharmProjects/opencode_mod/opencode-tool-surface/index.js"
]
```

in `~/.config/opencode/opencode.jsonc`, then restart OpenCode.

## Build / test

```sh
npm i
npm run build          # esbuild → index.js (the file opencode loads)
npm run typecheck
bun verify.mjs         # behavior checks incl. the no-consumption regression
```

## Scope filter

The transform only runs on `POST` requests whose URL contains `opencode.ai`
and whose JSON body is chat-shaped (has a `model` string) with a non-empty
`tools` array missing `bash`/`read`. Adjust the inline URL check in `index.ts`
if your gateway host differs.