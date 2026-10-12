/**
 * Appends a minimal `bash` + `read` tool surface to outgoing opencode.ai chat
 * requests (POST + JSON with a `model` string) that lack them.
 *
 * CRITICAL constraint (root cause of prior breakage): never `new Request(input)`
 * when `input` is already a Request — the constructor consumes the source
 * request's body ("Body is unusable: Body has already been read"), and
 * forwarding the then-bodyless original silently breaks the caller. Requests
 * are therefore only *inspected* via their own properties, and a rewritten
 * request is built fresh from url/method/headers so the original body stream
 * is never touched.
 */

 type ToolEntry = {
     type: "function";
     function: {
         name: string;
         description: string;
         parameters: {
             type: "object";
             properties: Record<string, never>;
             required: string[];
             additionalProperties: false;
         };
         strict: boolean;
     };
 };
 
 const BASH_ENTRY: ToolEntry = {
     type: "function",
     function: {
         name: "bash",
         description: "Don't use this",
         parameters: { type: "object", properties: {}, required: ["command"], additionalProperties: false },
         strict: true,
     },
 };
 const READ_ENTRY: ToolEntry = {
     type: "function",
     function: {
         name: "read",
         description: "Don't use this",
         parameters: { type: "object", properties: {}, required: ["path"], additionalProperties: false },
         strict: true,
     },
 };

function urlOf(input: Parameters<typeof globalThis.fetch>[0]): string | undefined {
    if (input instanceof Request) return input.url;
    if (input instanceof URL) return input.href;
    if (typeof input === "string") return input;
    return undefined;
}

/** Append the missing bash/read entries to body.tools. Returns changed flag. */
function withToolSurface(body: Record<string, unknown>): { changed: boolean } {
    const rawTools = body.tools;
     if (!Array.isArray(rawTools) || rawTools.length === 0) {
         // No tool surface defined at all (missing or empty) — leave untouched.
         return { changed: false };
     }
    const names = new Set<string>();
    for (const entry of rawTools) {
        if (!entry || typeof entry !== "object") continue;
        const fn = (entry as { function?: { name?: unknown } }).function;
        if (fn && typeof fn.name === "string") names.add(fn.name);
    }
    const missing: ToolEntry[] = [];
    if (!names.has("bash")) missing.push(BASH_ENTRY);
    if (!names.has("read")) missing.push(READ_ENTRY);
    if (missing.length > 0) {
        rawTools.push(...missing);
        return { changed: true };
    }
    return { changed: false };
}

let orig: typeof globalThis.fetch | undefined;

async function toolSurfaceFetch(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
): Promise<Response> {
    const fallback = () => orig!(input, init);
    try {
        const url = urlOf(input);
        const method = input instanceof Request ? input.method : (init?.method ?? "GET");
        if (method !== "POST" || !url || !url.toLowerCase().includes("opencode.ai")) return fallback();

        // Read the body without consuming the caller's request:
        // Request input -> clone (the clone is read, the original stays intact).
        // URL+string init -> init.body is a string, never a stream we'd eat.
        const text =
            input instanceof Request
                ? await input.clone().text().catch(() => "")
                : typeof init?.body === "string"
                  ? init.body
                  : "";
        let record: Record<string, unknown> | null = null;
        try {
            const parsed: unknown = JSON.parse(text);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                record = parsed as Record<string, unknown>;
            }
        } catch {
            /* not a JSON body */
        }
        if (!record || typeof record.model !== "string") return fallback();
        if (!withToolSurface(record).changed) return fallback();

        // Build the rewritten request FRESH. `new Request(existingRequest)`
        // would consume the original's body, so rebuild from parts only.
        const rewritten =
            input instanceof Request
                ? new Request(input.url, { method: input.method, headers: input.headers, body: JSON.stringify(record) })
                : new Request(input as string | URL, { ...init, body: JSON.stringify(record) });
        rewritten.headers.delete("content-length");
        return orig!(rewritten);
    } catch {
        return fallback();
    }
}

/* Entrypoint copied verbatim from opencode-trace. */
const main: ((input?: Record<string, unknown>) => Promise<object>) & { id?: unknown; server?: unknown } = async () => {
    if (!orig) {
        orig = globalThis.fetch.bind(globalThis);
        globalThis.fetch = toolSurfaceFetch;
    }
    return {};
};

const entrypoint = main; // opencode v1.3 expects default export to be a function
entrypoint.id = "opencode-tool-surface";
entrypoint.server = main; // opencode v1.4 expects default export to be an object, with server() being what executes
export default entrypoint;