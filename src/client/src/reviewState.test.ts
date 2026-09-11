// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearRolledBackSnapshotsForTest, isSnapshotRolledBack, recordRolledBackSnapshot } from "./reviewState";

describe("reviewState storage", () => {
  beforeEach(() => {
    localStorage.clear();
    clearRolledBackSnapshotsForTest();
  });

  afterEach(() => {
    localStorage.clear();
    clearRolledBackSnapshotsForTest();
  });

  it("records and queries rolled back snapshot IDs", () => {
    expect(isSnapshotRolledBack("snap-1")).toBe(false);

    recordRolledBackSnapshot("snap-1");
    expect(isSnapshotRolledBack("snap-1")).toBe(true);
    expect(isSnapshotRolledBack("snap-2")).toBe(false);

    recordRolledBackSnapshot("snap-2");
    expect(isSnapshotRolledBack("snap-1")).toBe(true);
    expect(isSnapshotRolledBack("snap-2")).toBe(true);
  });

  it("loads recorded snapshot IDs from localStorage", () => {
    localStorage.setItem("pi-web:rolled-back-review-snapshots", JSON.stringify(["snap-a", "snap-b"]));

    expect(isSnapshotRolledBack("snap-a")).toBe(true);
    expect(isSnapshotRolledBack("snap-b")).toBe(true);
    expect(isSnapshotRolledBack("snap-c")).toBe(false);
  });

  it("handles malformed localStorage entries gracefully", () => {
    localStorage.setItem("pi-web:rolled-back-review-snapshots", "{ not an array }");

    expect(isSnapshotRolledBack("snap-a")).toBe(false);
  });
});
