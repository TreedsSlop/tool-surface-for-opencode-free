Opencode Zen free requests get denied as "not originating from opencode" if the requests have tools, but not at least the bash and the read tools. Sometimes it is undesirable to provide certain tools with certain sessions.

This plugin adds the tools back all the way at the end of the request composition chain, so that the tools are not actually allowed within the opencode session. Only the request Opencode Zen sees is modified.

*Currently only for Opencode V1*

**Installation:**
1. clone this repository
2. add the path to index.js to your plugins in `~/.config/opencode/opencode.jsonc`:
```
  "plugin": [
 	"file:///[path to folder]/opencode-tool-surface/index.js"
  ]
```
3. restart opencode

\
*I'm not associated with opencode*