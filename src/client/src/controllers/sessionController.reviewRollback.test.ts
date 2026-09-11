import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewChangeRecord, RollbackReviewChangeResult } from "../../../shared/apiTypes";
import { initialAppState } from "../appState";
import { clearRolledBackSnapshotsForTest, isSnapshotRolledBack } from "../reviewState";
import { SessionController } from "./sessionController";
import { defaultApi, oldSession, workspace, type AppState } from "./sessionController.testSupport";

function hasReviewRecord(details: unknown): details is { review: ReviewChangeRecord } {
  if (typeof details !== "object" || details === null) return false;
  return "review" in details;
}

describe("SessionController rollbackReview", () => {
  beforeEach(() => {
    clearRolledBackSnapshotsForTest();
  });

  afterEach(() => {
    clearRolledBackSnapshotsForTest();
  });

  it("returns unavailable if no session is selected", async () => {
    let state: AppState = { ...initialAppState(), selectedSession: undefined };
    const controller = new SessionController(
      () => state,
      (next) => { state = { ...state, ...next }; },
      () => undefined,
    );

    const result = await controller.rollbackReview("snap-1");
    expect(result).toEqual({ kind: "unavailable", detail: "No active session selected" });
  });

  it("returns unavailable if the selected session is archived", async () => {
    let state: AppState = {
      ...initialAppState(),
      selectedSession: { ...oldSession, archived: true },
    };
    const controller = new SessionController(
      () => state,
      (next) => { state = { ...state, ...next }; },
      () => undefined,
    );

    const result = await controller.rollbackReview("snap-1");
    expect(result).toEqual({ kind: "unavailable", detail: "No active session selected" });
  });

  it("calls api.rollbackReview and updates message state and storage on success", async () => {
    const reviewRecord: ReviewChangeRecord = {
      snapshotId: "snap-123",
      sessionId: oldSession.id,
      path: "test.txt",
      operation: "write",
      status: "modified",
      state: "active",
      additions: 1,
      deletions: 1,
      reversible: true,
      truncated: false,
      capturedAt: "2026-09-11T00:00:00.000Z",
    };

    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      messages: [
        {
          role: "assistant",
          parts: [
            {
              type: "toolExecution",
              toolName: "write",
              summary: "write test.txt",
              status: "success",
              details: { review: reviewRecord },
            },
          ],
        },
      ],
    };

    const rollbackMock = vi.fn(() => Promise.resolve<RollbackReviewChangeResult>({
      kind: "rolledBack",
      record: { ...reviewRecord, state: "rolledBack" },
    }));

    const api: typeof defaultApi = {
      ...defaultApi,
      rollbackReview: rollbackMock,
    };

    const controller = new SessionController(
      () => state,
      (next) => { state = { ...state, ...next }; },
      () => undefined,
      undefined,
      { api },
    );

    const result = await controller.rollbackReview("snap-123");
    expect(result.kind).toBe("rolledBack");
    expect(rollbackMock).toHaveBeenCalledWith(oldSession, "snap-123", "local");
    expect(isSnapshotRolledBack("snap-123")).toBe(true);

    const toolExecutionPart = state.messages[0]?.parts[0];
    if (toolExecutionPart?.type === "toolExecution" && hasReviewRecord(toolExecutionPart.details)) {
      expect(toolExecutionPart.details.review.state).toBe("rolledBack");
    } else {
      expect.unreachable("toolExecutionPart should have updated review details");
    }
  });

  it("handles conflict outcome without updating messages or storage", async () => {
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      messages: [],
    };

    const rollbackMock = vi.fn(() => Promise.resolve<RollbackReviewChangeResult>({
      kind: "conflict",
      detail: "Disk file modified",
    }));

    const api: typeof defaultApi = {
      ...defaultApi,
      rollbackReview: rollbackMock,
    };

    const controller = new SessionController(
      () => state,
      (next) => { state = { ...state, ...next }; },
      () => undefined,
      undefined,
      { api },
    );

    const result = await controller.rollbackReview("snap-123");
    expect(result).toEqual({ kind: "conflict", detail: "Disk file modified" });
    expect(isSnapshotRolledBack("snap-123")).toBe(false);
  });
});
