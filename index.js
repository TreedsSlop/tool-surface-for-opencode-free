const BASH_ENTRY = {
  type: "function",
  function: {
    name: "bash",
    description: "Don't use this",
    parameters: { type: "object", properties: {}, required: ["command"], additionalProperties: false },
    strict: true
  }
};
const READ_ENTRY = {
  type: "function",
  function: {
    name: "read",
    description: "Don't use this",
    parameters: { type: "object", properties: {}, required: ["path"], additionalProperties: false },
    strict: true
  }
};
function urlOf(input) {
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  if (typeof input === "string") return input;
  return void 0;
}
function withToolSurface(body) {
  const rawTools = body.tools;
  if (!Array.isArray(rawTools) || rawTools.length === 0) {
    return { changed: false };
  }
  const names = /* @__PURE__ */ new Set();
  for (const entry of rawTools) {
    if (!entry || typeof entry !== "object") continue;
    const fn = entry.function;
    if (fn && typeof fn.name === "string") names.add(fn.name);
  }
  const missing = [];
  if (!names.has("bash")) missing.push(BASH_ENTRY);
  if (!names.has("read")) missing.push(READ_ENTRY);
  if (missing.length > 0) {
    rawTools.push(...missing);
    return { changed: true };
  }
  return { changed: false };
}
let orig;
async function toolSurfaceFetch(input, init) {
  const fallback = () => orig(input, init);
  try {
    const url = urlOf(input);
    const method = input instanceof Request ? input.method : init?.method ?? "GET";
    if (method !== "POST" || !url || !url.toLowerCase().includes("opencode.ai")) return fallback();
    const text = input instanceof Request ? await input.clone().text().catch(() => "") : typeof init?.body === "string" ? init.body : "";
    let record = null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        record = parsed;
      }
    } catch {
    }
    if (!record || typeof record.model !== "string") return fallback();
    if (!withToolSurface(record).changed) return fallback();
    const rewritten = input instanceof Request ? new Request(input.url, { method: input.method, headers: input.headers, body: JSON.stringify(record) }) : new Request(input, { ...init, body: JSON.stringify(record) });
    rewritten.headers.delete("content-length");
    return orig(rewritten);
  } catch {
    return fallback();
  }
}
const main = async () => {
  if (!orig) {
    orig = globalThis.fetch.bind(globalThis);
    globalThis.fetch = toolSurfaceFetch;
  }
  return {};
};
const entrypoint = main;
entrypoint.id = "opencode-tool-surface";
entrypoint.server = main;
var index_default = entrypoint;
export {
  index_default as default
};
