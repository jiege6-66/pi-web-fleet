import { describe, expect, it } from "vitest";
import {
  ALLOW_ONCE_CHOICE,
  APPROVAL_TIMEOUT_MS,
  DENY_CHOICE,
  GRANT_ENTRY_TYPE,
  PREVIEW_MAX_LENGTH,
  allowSessionChoice,
  approvalDialogTitle,
  auditLabel,
  blockReason,
  decisionForChoice,
  isGrantEntryForTool,
  isGatedTool,
  sessionAllowsTool,
  toolSummary,
} from "./permissionPolicy";

function grantEntry(tool: string): unknown {
  return { type: "custom", customType: GRANT_ENTRY_TYPE, data: { tool, at: "2026-09-11T00:00:00.000Z" } };
}

describe("isGatedTool", () => {
  it("gates workspace-mutating tools", () => {
    expect(isGatedTool("write")).toBe(true);
    expect(isGatedTool("edit")).toBe(true);
    expect(isGatedTool("bash")).toBe(true);
  });

  it("leaves read-only tools ungated", () => {
    for (const tool of ["read", "ls", "grep", "find", "unknown-tool"]) {
      expect(isGatedTool(tool)).toBe(false);
    }
  });
});

describe("toolSummary", () => {
  it("keeps short inputs intact", () => {
    expect(toolSummary({ path: "/tmp/a" })).toBe('{"path":"/tmp/a"}');
  });

  it("truncates long inputs to the preview bound", () => {
    const summary = toolSummary({ content: "x".repeat(1_000) });
    expect(summary.length).toBe(PREVIEW_MAX_LENGTH);
    expect(summary.endsWith("...")).toBe(true);
  });
});

describe("approvalDialogTitle", () => {
  it("carries the tool name, the argument preview, and the workspace", () => {
    const title = approvalDialogTitle("write", { path: "/tmp/a" }, "/workspace");
    expect(title).toContain("write");
    expect(title).toContain('{"path":"/tmp/a"}');
    expect(title).toContain("Workspace: /workspace");
  });
});

describe("sessionAllowsTool", () => {
  it("finds a grant for the exact tool", () => {
    expect(sessionAllowsTool([grantEntry("bash")], "bash")).toBe(true);
  });

  it("does not grant other tools", () => {
    expect(sessionAllowsTool([grantEntry("bash")], "write")).toBe(false);
  });

  it("ignores foreign entries and malformed grants", () => {
    const entries: unknown[] = [
      { type: "message", customType: GRANT_ENTRY_TYPE, data: { tool: "bash" } },
      { type: "custom", customType: "pi-web:permission-audit", data: { tool: "bash" } },
      { type: "custom", customType: GRANT_ENTRY_TYPE, data: "bash" },
      { type: "custom", customType: GRANT_ENTRY_TYPE },
      null,
      "grant",
    ];
    expect(sessionAllowsTool(entries, "bash")).toBe(false);
  });

  it("sees a later grant after re-reading the session entries", () => {
    const before: unknown[] = [grantEntry("bash")];
    expect(sessionAllowsTool(before, "write")).toBe(false);
    const after: unknown[] = [...before, grantEntry("write")];
    expect(sessionAllowsTool(after, "write")).toBe(true);
  });
});

describe("isGrantEntryForTool", () => {
  it("accepts a well-formed grant", () => {
    expect(isGrantEntryForTool(grantEntry("edit"), "edit")).toBe(true);
  });

  it("rejects arrays", () => {
    expect(isGrantEntryForTool(["custom"], "edit")).toBe(false);
  });
});

describe("decisionForChoice", () => {
  it("maps allow-once", () => {
    expect(decisionForChoice(ALLOW_ONCE_CHOICE, "write")).toEqual({ kind: "allow", reason: "allow-once" });
  });

  it("maps the session grant choice by exact tool label", () => {
    expect(decisionForChoice(allowSessionChoice("write"), "write")).toEqual({ kind: "allow", reason: "allow-session" });
    expect(decisionForChoice(allowSessionChoice("bash"), "write")).toEqual({ kind: "block", reason: "unanswered" });
  });

  it("maps deny", () => {
    expect(decisionForChoice(DENY_CHOICE, "bash")).toEqual({ kind: "block", reason: "denied" });
  });

  it("treats cancel and timeout (undefined) as unanswered blocks", () => {
    expect(decisionForChoice(undefined, "bash")).toEqual({ kind: "block", reason: "unanswered" });
  });
});

describe("blockReason", () => {
  it("names the tool and the fail-closed rule when no UI exists", () => {
    expect(blockReason({ kind: "block", reason: "no-ui" }, "write")).toContain("no dialog UI");
  });

  it("distinguishes denial from timeout", () => {
    expect(blockReason({ kind: "block", reason: "denied" }, "bash")).toContain("denied by the operator");
    expect(blockReason({ kind: "block", reason: "unanswered" }, "bash")).toContain("not answered");
  });

  it("blames the operator vs the silence with distinct text", () => {
    expect(blockReason({ kind: "block", reason: "denied" }, "bash")).not.toBe(
      blockReason({ kind: "block", reason: "unanswered" }, "bash"),
    );
  });
});

describe("auditLabel", () => {
  it("labels every decision shape", () => {
    expect(auditLabel({ kind: "allow", reason: "allow-once" })).toBe("allow-once");
    expect(auditLabel({ kind: "allow", reason: "allow-session" })).toBe("allow-session");
    expect(auditLabel({ kind: "allow", reason: "session-grant" })).toBe("allow-session-grant");
    expect(auditLabel({ kind: "block", reason: "no-ui" })).toBe("blocked-no-ui");
    expect(auditLabel({ kind: "block", reason: "denied" })).toBe("deny");
    expect(auditLabel({ kind: "block", reason: "unanswered" })).toBe("timeout-or-cancel");
  });
});

describe("constants", () => {
  it("keeps the PI-Desktop 120 s approval window", () => {
    expect(APPROVAL_TIMEOUT_MS).toBe(120_000);
  });
});
