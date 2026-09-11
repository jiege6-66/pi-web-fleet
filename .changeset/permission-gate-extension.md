---
"@jmfederico/pi-web": minor
---

Add a bundled permission-gate Pi package: write/edit/bash tool calls are held for operator approval through the web dialog chain (allow once / allow for session / deny, 120 s auto-deny), with session grants and an audit trail recorded as session custom entries. Enforcement runs in the session daemon's `tool_call` hook, so the web UI only renders and routes the dialogs.
