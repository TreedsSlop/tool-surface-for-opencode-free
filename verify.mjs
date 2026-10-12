import entrypoint from "./index.js";

let failures = 0;
const ok = (name, cond, extra) => {
    if (cond) console.log(`PASS ${name}`);
    else {
        failures++;
        console.log(`FAIL ${name}${extra ? " — " + JSON.stringify(extra) : ""}`);
    }
};

const modKeys = Object.keys(await import("./index.js")).filter((k) => k !== "default");
ok("module exports only default", modKeys.length === 0);

let captured = []; // { url, method, body }
globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = input instanceof Request ? input.method : (init?.method ?? "GET");
    let body = null;
    if (input instanceof Request) body = await input.clone().text().catch(() => null);
    else if (typeof init?.body === "string") body = init.body;
    captured.push({ url, method, body: body ? JSON.parse(body) : null });
    return new Response("{}");
};

const hooks = entrypoint.server({});
ok("server() runs", hooks && typeof hooks === "object");

const names = (i) => (captured[i].body.tools ?? []).map((t) => t.function.name);
const findTool = (i, name) => (captured[i].body.tools ?? []).find((t) => t.function.name === name)?.function;

// 1. Regression: a Request-object fetch (any host) forwards with BODY INTACT (nothing consumed).
const originalRequest = new Request("http://localhost:3910/session/abc/tool", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ payload: "critical" }),
});
await globalThis.fetch(originalRequest);
ok("Request fetch body intact", captured[0].body?.payload === "critical", captured[0].body);

// 2. Request with tools ["grep"] -> bash+read appended with the new footprint.
await globalThis.fetch(
    new Request("https://api.opencode.ai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", tools: [{ type: "function", function: { name: "grep" } }] }),
    }),
);
ok("Request fetch rewritten", names(1).join(",") === "grep,bash,read");
const bash = findTool(1, "bash");
ok("bash footprint", bash?.description === "Don't use this" && JSON.stringify(bash.parameters?.required) === '["command"]' && bash.strict === true && bash.parameters?.additionalProperties === false, bash);
const read = findTool(1, "read");
ok("read footprint", read?.description === "Don't use this" && JSON.stringify(read.parameters?.required) === '["path"]' && read.strict === true && read.parameters?.additionalProperties === false, read);

// 3. NO tools defined at all -> do NOT add the surface.
await globalThis.fetch("https://api.opencode.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "m" }),
});
ok("no tools field -> untouched", captured[2].body && !("tools" in captured[2].body));

// 4. Empty tools array -> untouched.
await globalThis.fetch("https://api.opencode.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "m", tools: [] }),
});
ok("empty tools array -> untouched", Array.isArray(captured[3].body.tools) && captured[3].body.tools.length === 0);

// 5. Already carrying both -> untouched.
await globalThis.fetch("https://api.opencode.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
        model: "m",
        tools: [
            { type: "function", function: { name: "bash" } },
            { type: "function", function: { name: "read" } },
        ],
    }),
});
ok("both present untouched", names(4).join(",") === "bash,read");

// 6. opencode.ai /token (no model) -> untouched.
await globalThis.fetch("https://api.opencode.ai/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "refresh_token" }),
});
ok("token untouched", !("tools" in captured[5].body));

// 7. Foreign host Request fetch -> body intact.
const foreign = new Request("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "claude", tools: [{ type: "function", function: { name: "grep" } }] }),
});
await globalThis.fetch(foreign);
ok("foreign host intact", names(6).join(",") === "grep");

// 8. The original Request is still readable after the wrapper forwarded it.
ok("original Request body survives wrapper", (await originalRequest.clone().text()).includes("critical"));

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);