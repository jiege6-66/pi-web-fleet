// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewChangeRecord, RollbackReviewChangeResult } from "../../../shared/apiTypes";
import { clearRolledBackSnapshotsForTest, isSnapshotRolledBack } from "../reviewState";
import type { ToolExecutionPart } from "./shared";
import { ToolExecutionView } from "./ToolExecutionView";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
  clearRolledBackSnapshotsForTest();
});

function createReviewRecord(overrides: Partial<ReviewChangeRecord> = {}, omitHunks = false): ReviewChangeRecord {
  const record: ReviewChangeRecord = {
    snapshotId: "snap-123",
    sessionId: "sess-abc",
    path: "rollback-me.txt",
    operation: "write",
    status: "modified",
    state: "active",
    additions: 1,
    deletions: 2,
    reversible: true,
    truncated: false,
    capturedAt: "2026-09-11T12:00:00.000Z",
    ...overrides,
  };
  if (!omitHunks) {
    record.hunks = [
      {
        oldStart: 1,
        newStart: 1,
        lines: [
          { kind: "remove", oldLine: 1, text: "v1 original" },
          { kind: "remove", oldLine: 2, text: "" },
          { kind: "add", newLine: 1, text: "v2 by agent" },
        ],
      },
    ];
  }
  return record;
}

function createExecution(toolName = "write", review?: ReviewChangeRecord): ToolExecutionPart {
  return {
    type: "toolExecution",
    toolCallId: "call-1",
    toolName,
    summary: `write ${review?.path ?? "file.txt"}`,
    status: "success",
    resultText: "Successfully written",
    details: review === undefined ? undefined : { review },
  };
}

async function mountView(
  execution: ToolExecutionPart,
  options: {
    rolledBack?: boolean;
    onRollbackReview?: (snapshotId: string) => Promise<RollbackReviewChangeResult | undefined>;
  } = {},
): Promise<ToolExecutionView> {
  const view = new ToolExecutionView();
  view.execution = execution;
  if (options.rolledBack !== undefined) view.rolledBack = options.rolledBack;
  if (options.onRollbackReview !== undefined) view.onRollbackReview = options.onRollbackReview;
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function renderRoot(view: ToolExecutionView): ShadowRoot {
  if (view.shadowRoot === null) throw new Error("Expected shadowRoot");
  return view.shadowRoot;
}

describe("ToolExecutionView review card rendering", () => {
  it("does not render review card if tool is not write or edit", async () => {
    const review = createReviewRecord();
    const execution = createExecution("bash", review);
    const view = await mountView(execution);
    const root = renderRoot(view);

    expect(root.querySelector(".review-card")).toBeNull();
  });

  it("does not render review card if details has no review", async () => {
    const execution = createExecution("write", undefined);
    const view = await mountView(execution);
    const root = renderRoot(view);

    expect(root.querySelector(".review-card")).toBeNull();
  });

  it("renders review card with file path, status badge, diff stats, and hunks", async () => {
    const review = createReviewRecord();
    const execution = createExecution("write", review);
    const view = await mountView(execution);
    const root = renderRoot(view);

    const card = root.querySelector(".review-card");
    expect(card).not.toBeNull();
    expect(card?.getAttribute("data-snapshot-id")).toBe("snap-123");

    const pathEl = root.querySelector(".review-path");
    expect(pathEl?.textContent).toBe("rollback-me.txt");

    const statusBadge = root.querySelector(".review-status-badge");
    expect(statusBadge?.textContent).toBe("modified");
    expect(statusBadge?.classList.contains("modified")).toBe(true);

    const added = root.querySelector(".diff-stats .added");
    const removed = root.querySelector(".diff-stats .removed");
    expect(added?.textContent).toBe("+1");
    expect(removed?.textContent).toBe("−2");

    const hunksDetails = root.querySelector(".review-hunks-details");
    expect(hunksDetails).not.toBeNull();

    const summaryText = hunksDetails?.querySelector("summary")?.textContent;
    expect(summaryText).toContain("Changes");
    expect(summaryText).toContain("3 lines");

    const lines = root.querySelectorAll(".review-line");
    expect(lines).toHaveLength(3);
    expect(lines[0]?.classList.contains("remove")).toBe(true);
    expect(lines[0]?.querySelector(".line-text")?.textContent).toBe("v1 original");
    expect(lines[2]?.classList.contains("add")).toBe(true);
    expect(lines[2]?.querySelector(".line-text")?.textContent).toBe("v2 by agent");
  });

  it("disables rollback button when reversible is false", async () => {
    const review = createReviewRecord({ reversible: false });
    const execution = createExecution("edit", review);
    const view = await mountView(execution);
    const root = renderRoot(view);

    const btn = root.querySelector<HTMLButtonElement>(".rollback-button");
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(true);
    expect(btn?.title).toBe("Rollback unavailable");
    expect(btn?.textContent).toBe("Rollback");
  });

  it("displays truncation notice when truncated is true", async () => {
    const review = createReviewRecord({ truncated: true, reversible: false }, true);
    const execution = createExecution("write", review);
    const view = await mountView(execution);
    const root = renderRoot(view);

    const notice = root.querySelector(".review-notice");
    expect(notice?.textContent).toBe("内容过大，未保存 diff / 不可回滚");
    expect(root.querySelector(".review-hunks-details")).toBeNull();
  });

  it("shows disabled 'Rolled back' button when review state is rolledBack", async () => {
    const review = createReviewRecord({ state: "rolledBack" });
    const execution = createExecution("write", review);
    const view = await mountView(execution);
    const root = renderRoot(view);

    const btn = root.querySelector<HTMLButtonElement>(".rollback-button");
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent).toBe("Rolled back");
  });

  it("shows disabled 'Rolled back' button when view.rolledBack is true", async () => {
    const review = createReviewRecord({ state: "active" });
    const execution = createExecution("write", review);
    const view = await mountView(execution, { rolledBack: true });
    const root = renderRoot(view);

    const btn = root.querySelector<HTMLButtonElement>(".rollback-button");
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent).toBe("Rolled back");
  });
});

describe("ToolExecutionView rollback interactions", () => {
  beforeEach(() => {
    window.confirm = vi.fn().mockReturnValue(true);
    clearRolledBackSnapshotsForTest();
  });

  it("aborts rollback if user cancels confirm dialog", async () => {
    const review = createReviewRecord();
    const execution = createExecution("write", review);
    const onRollbackReview = vi.fn<() => Promise<RollbackReviewChangeResult>>();
    const confirmSpy = vi.fn().mockReturnValue(false);
    window.confirm = confirmSpy;

    const view = await mountView(execution, { onRollbackReview });
    const root = renderRoot(view);

    const btn = root.querySelector<HTMLButtonElement>(".rollback-button");
    btn?.click();
    await view.updateComplete;

    expect(confirmSpy).toHaveBeenCalledWith("Roll back changes to rollback-me.txt?");
    expect(onRollbackReview).not.toHaveBeenCalled();
  });

  it("invokes onRollbackReview on confirm and updates UI to rolledBack on success", async () => {
    const review = createReviewRecord();
    const execution = createExecution("write", review);

    let resolvePromise!: (val: RollbackReviewChangeResult) => void;
    const deferred = new Promise<RollbackReviewChangeResult>((res) => { resolvePromise = res; });
    const onRollbackReview = vi.fn().mockReturnValue(deferred);

    const view = await mountView(execution, { onRollbackReview });
    const root = renderRoot(view);

    const btn = root.querySelector<HTMLButtonElement>(".rollback-button");
    expect(btn?.disabled).toBe(false);
    expect(btn?.textContent).toBe("Rollback");

    btn?.click();
    await view.updateComplete;

    expect(onRollbackReview).toHaveBeenCalledWith("snap-123");
    const rollingBtn = root.querySelector<HTMLButtonElement>(".rollback-button");
    expect(rollingBtn?.disabled).toBe(true);
    expect(rollingBtn?.textContent).toBe("Rolling back...");

    resolvePromise({
      kind: "rolledBack",
      record: { ...review, state: "rolledBack" },
    });
    await deferred;
    await view.updateComplete;

    const rolledBackBtn = root.querySelector<HTMLButtonElement>(".rollback-button");
    expect(rolledBackBtn?.disabled).toBe(true);
    expect(rolledBackBtn?.textContent).toBe("Rolled back");
    expect(isSnapshotRolledBack("snap-123")).toBe(true);
  });

  it("displays conflict error when rollback returns conflict", async () => {
    const review = createReviewRecord();
    const execution = createExecution("write", review);
    const onRollbackReview = vi.fn().mockResolvedValue({
      kind: "conflict",
      detail: "File modified concurrently",
    });

    const view = await mountView(execution, { onRollbackReview });
    const root = renderRoot(view);

    root.querySelector<HTMLButtonElement>(".rollback-button")?.click();
    await view.updateComplete;
    await Promise.resolve();
    await view.updateComplete;

    const errorEl = root.querySelector(".review-error");
    expect(errorEl?.textContent).toBe("Conflict: File modified concurrently");
    const btn = root.querySelector<HTMLButtonElement>(".rollback-button");
    expect(btn?.disabled).toBe(false);
    expect(btn?.textContent).toBe("Rollback");
  });

  it("displays unavailable error when rollback returns unavailable", async () => {
    const review = createReviewRecord();
    const execution = createExecution("write", review);
    const onRollbackReview = vi.fn().mockResolvedValue({
      kind: "unavailable",
      detail: "Backup not retained",
    });

    const view = await mountView(execution, { onRollbackReview });
    const root = renderRoot(view);

    root.querySelector<HTMLButtonElement>(".rollback-button")?.click();
    await view.updateComplete;
    await Promise.resolve();
    await view.updateComplete;

    const errorEl = root.querySelector(".review-error");
    expect(errorEl?.textContent).toBe("Unavailable: Backup not retained");
  });

  it("displays error when rollback rejects", async () => {
    const review = createReviewRecord();
    const execution = createExecution("write", review);
    const onRollbackReview = vi.fn().mockRejectedValue(new Error("Network failure"));

    const view = await mountView(execution, { onRollbackReview });
    const root = renderRoot(view);

    root.querySelector<HTMLButtonElement>(".rollback-button")?.click();
    await view.updateComplete;
    await Promise.resolve();
    await view.updateComplete;

    const errorEl = root.querySelector(".review-error");
    expect(errorEl?.textContent).toBe("Network failure");
  });
});
