/**
 * Pure decision logic of the permission gate, kept free of the Pi extension
 * API so the policy can be unit-tested directly. `index.ts` wires these
 * helpers into the `tool_call` hook; everything decided here is ordinary data.
 */

/** Tools whose calls are gated: they mutate the workspace or run commands. */
export const GATED_TOOL_NAMES: readonly string[] = ["write", "edit", "bash"];

/** 120 s — the PI-Desktop approval-card auto-deny window. */
export const APPROVAL_TIMEOUT_MS = 120_000;

/** Session custom-entry types written by the gate. */
export const GRANT_ENTRY_TYPE = "pi-web:permission-grant";
export const AUDIT_ENTRY_TYPE = "pi-web:permission-audit";

/** Bound for the one-line argument preview embedded in the dialog title. */
export const PREVIEW_MAX_LENGTH = 200;

export const ALLOW_ONCE_CHOICE = "Allow once";
export const DENY_CHOICE = "Deny";

/** What the gate decided about a tool call, as data. */
export type ApprovalDecision =
  | { kind: "allow"; reason: "not-gated" | "session-grant" | "allow-once" | "allow-session" }
  | { kind: "block"; reason: "no-ui" | "denied" | "unanswered" };

/** The blocking half of {@link ApprovalDecision}. */
export type BlockingDecision = Extract<ApprovalDecision, { kind: "block" }>;

export function isGatedTool(toolName: string): boolean {
  return GATED_TOOL_NAMES.some((candidate) => candidate === toolName);
}

export function allowSessionChoice(toolName: string): string {
  return `Allow for this session (${toolName})`;
}

export function toolSummary(input: Record<string, unknown>): string {
  const serialized = JSON.stringify(input);
  return serialized.length <= PREVIEW_MAX_LENGTH ? serialized : `${serialized.slice(0, PREVIEW_MAX_LENGTH - 3)}...`;
}

export function approvalDialogTitle(toolName: string, input: Record<string, unknown>, cwd: string): string {
  return `Approval required — ${toolName}\n${toolSummary(input)}\nWorkspace: ${cwd}`;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `value` is a `pi-web:permission-grant` entry granting `toolName`. */
export function isGrantEntryForTool(value: unknown, toolName: string): boolean {
  if (!isJsonObject(value)) return false;
  if (value["type"] !== "custom" || value["customType"] !== GRANT_ENTRY_TYPE) return false;
  const data = value["data"];
  return isJsonObject(data) && data["tool"] === toolName;
}

/**
 * Whether the session's custom entries contain a session grant for `toolName`.
 * Scans newest-first so the latest decision wins if entries ever disagree.
 */
export function sessionAllowsTool(entries: readonly unknown[], toolName: string): boolean {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (isGrantEntryForTool(entries[index], toolName)) return true;
  }
  return false;
}

/** Map the operator's dialog answer (or its absence) onto a decision. */
export function decisionForChoice(choice: string | undefined, toolName: string): ApprovalDecision {
  if (choice === ALLOW_ONCE_CHOICE) return { kind: "allow", reason: "allow-once" };
  if (choice === allowSessionChoice(toolName)) return { kind: "allow", reason: "allow-session" };
  if (choice === DENY_CHOICE) return { kind: "block", reason: "denied" };
  return { kind: "block", reason: "unanswered" };
}

/** The one-line reason shown to the agent for a blocking decision. */
export function blockReason(decision: BlockingDecision, toolName: string): string {
  if (decision.reason === "no-ui") {
    return `Approval required for ${toolName}, but no dialog UI is available; blocked (fail closed).`;
  }
  if (decision.reason === "denied") return `Approval for ${toolName} was denied by the operator.`;
  return `Approval for ${toolName} was not answered (cancelled or timed out); blocked.`;
}

/** Audit label for a decision, as written to `pi-web:permission-audit`. */
export function auditLabel(decision: ApprovalDecision): string {
  switch (decision.reason) {
    case "not-gated":
      return "not-gated";
    case "session-grant":
      return "allow-session-grant";
    case "allow-once":
      return "allow-once";
    case "allow-session":
      return "allow-session";
    case "no-ui":
      return "blocked-no-ui";
    case "denied":
      return "deny";
    case "unanswered":
      return "timeout-or-cancel";
  }
}
