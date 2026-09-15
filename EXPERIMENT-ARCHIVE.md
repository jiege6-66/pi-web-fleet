# PI WEB port experiment archive

This source snapshot preserves the experimental permission gate, message-owned review snapshots and rollback, and English / Simplified Chinese plugin UI work before the experimental deployment is retired.

Verified locally inside Docker before archival:
- TypeScript `tsc --noEmit`: passed.
- ESLint for the affected plugin/i18n/component scope: passed.
- Targeted plugin, i18n and ToolExecutionView regression: 52 files, 429 tests passed.
- Plugin TypeScript check and Vite client production build: passed (bundle-size warnings remain).

This is an archival source snapshot, not a production release or a claim that the entire repository test suite or live multi-machine browser acceptance passed. Earlier full-suite timing-sensitive failures require further investigation. Concurrent filesystem rollback and preservation of ACLs/extended attributes are not guaranteed.

Runtime credentials, personal sessions, model configuration and deployment data are intentionally excluded. Restore using the repository's documented Docker development workflow and provide new local credentials. The experimental server deployment is being removed; the source remains available here.
