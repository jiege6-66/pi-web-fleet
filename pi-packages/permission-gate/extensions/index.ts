/**
 * PI WEB Fleet — Permission Gate extension (slice 1).
 *
 * Gates tool calls that mutate the workspace (`write`, `edit`, `bash`) behind
 * an operator approval surfaced through PI WEB's extension-dialog chain: the
 * tool never runs until the dialog is answered. Enforcement lives HERE, in the
 * session daemon's `tool_call` hook — the web UI only renders and routes the
 * dialog, so a closed popup cannot weaken it.
 *
 * Decisions are recorded as session custom entries:
 * - `pi-web:permission-grant` — session-scoped allowances, re-read on every
 *   gated call (no in-memory cache: the session JSONL is the source of truth).
 * - `pi-web:permission-audit` — one entry per decision (tool, decision, time).
 *
 * Fail-closed behaviors: no dialog-capable UI → block; unanswered dialog
 * (cancel/timeout) → block. `read`/`ls`/`grep`/`find` are deliberately not
 * gated — only workspace mutations require approval.
 *
 * The policy itself lives in `permissionPolicy.ts` as pure functions; this
 * module only wires them to the Pi extension API.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  APPROVAL_TIMEOUT_MS,
  AUDIT_ENTRY_TYPE,
  DENY_CHOICE,
  GRANT_ENTRY_TYPE,
  ALLOW_ONCE_CHOICE,
  allowSessionChoice,
  approvalDialogTitle,
  auditLabel,
  blockReason,
  decisionForChoice,
  isGatedTool,
  sessionAllowsTool,
  type ApprovalDecision,
} from "./permissionPolicy.js";

function audit(pi: ExtensionAPI, tool: string, decision: ApprovalDecision): void {
  pi.appendEntry(AUDIT_ENTRY_TYPE, { tool, decision: auditLabel(decision), at: new Date().toISOString() });
}

/** Build the hook's block result when the decision blocks, else undefined. */
function blockResult(decision: ApprovalDecision, toolName: string): { block: true; reason: string } | undefined {
  if (decision.kind !== "block") return undefined;
  return { block: true, reason: blockReason(decision, toolName) };
}

export default function permissionGateExtension(pi: ExtensionAPI): void {
  pi.on("tool_call", async (event, ctx) => {
    if (!isGatedTool(event.toolName)) return undefined;

    if (sessionAllowsTool(ctx.sessionManager.getEntries(), event.toolName)) {
      audit(pi, event.toolName, { kind: "allow", reason: "session-grant" });
      return undefined;
    }

    if (!ctx.hasUI) {
      const decision: ApprovalDecision = { kind: "block", reason: "no-ui" };
      audit(pi, event.toolName, decision);
      return blockResult(decision, event.toolName);
    }

    const choice = await ctx.ui.select(
      approvalDialogTitle(event.toolName, event.input, ctx.cwd),
      [ALLOW_ONCE_CHOICE, allowSessionChoice(event.toolName), DENY_CHOICE],
      { timeout: APPROVAL_TIMEOUT_MS },
    );

    const decision = decisionForChoice(choice, event.toolName);
    if (decision.kind === "allow" && decision.reason === "allow-session") {
      pi.appendEntry(GRANT_ENTRY_TYPE, { tool: event.toolName, at: new Date().toISOString() });
    }
    audit(pi, event.toolName, decision);

    return blockResult(decision, event.toolName);
  });
}
