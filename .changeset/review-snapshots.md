---
"@jmfederico/pi-web": minor
---

Add message-owned review snapshots with guarded rollback for workspace write/edit tools: each tool run captures the pre-tool file bytes outside the workspace, records a bounded `details.review` (status, add/delete counts, hunks) on the tool result, and exposes `POST /sessions/:sessionId/review/rollback`. Rollback only restores when the current file still matches what the tool left behind (`conflict` otherwise) and removes the snapshot store when the session is deleted.
