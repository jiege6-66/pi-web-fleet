import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  REVIEW_MAX_RETAINED_BYTES,
  finalizeReviewChange,
  prepareReviewChange,
  removeSessionReviewStore,
  reviewRelativePath,
  rollbackReviewChange,
  sessionReviewDir,
} from "./reviewStore";

let dataDir: string;
let workspace: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "review-store-data-"));
  workspace = await mkdtemp(join(tmpdir(), "review-store-ws-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
});

const opts = () => ({ dataDir, sessionId: "session-1", workspaceRoot: workspace });

describe("reviewRelativePath", () => {
  it("relativizes inside the workspace with forward slashes", () => {
    expect(reviewRelativePath(workspace, join(workspace, "src", "a.ts"))).toBe("src/a.ts");
  });

  it("returns the absolute path for files outside the workspace", () => {
    expect(reviewRelativePath(workspace, "/etc/hosts")).toBe("/etc/hosts");
  });
});

describe("prepare + finalize", () => {
  it("records an added file with an add-only hunk", async () => {
    const target = join(workspace, "new.txt");
    const pending = await prepareReviewChange({ ...opts(), operation: "write", filePath: target });
    await writeFile(target, "line one\nline two\n");
    const finalized = await finalizeReviewChange(dataDir, pending, await readFile(target));

    expect(finalized.kind).toBe("record");
    if (finalized.kind !== "record") return;
    expect(finalized.record.status).toBe("added");
    expect(finalized.record.path).toBe("new.txt");
    expect(finalized.record.additions).toBe(3);
    expect(finalized.record.hunks?.[0]?.lines.every((line) => line.kind === "add")).toBe(true);
  });

  it("records a modification with add/remove counts and context", async () => {
    const target = join(workspace, "mod.txt");
    await writeFile(target, "keep\nalpha\nkeep-tail\n");
    const pending = await prepareReviewChange({ ...opts(), operation: "edit", filePath: target });
    await writeFile(target, "keep\nbeta\nkeep-tail\n");
    const finalized = await finalizeReviewChange(dataDir, pending, await readFile(target));

    expect(finalized.kind).toBe("record");
    if (finalized.kind !== "record") return;
    expect(finalized.record.status).toBe("modified");
    expect(finalized.record.additions).toBe(1);
    expect(finalized.record.deletions).toBe(1);
    const kinds = finalized.record.hunks?.[0]?.lines.map((line) => line.kind) ?? [];
    expect(kinds).toContain("context");
    expect(kinds).toContain("add");
    expect(kinds).toContain("remove");
  });

  it("skips (and cleans up) when the content did not change", async () => {
    const target = join(workspace, "same.txt");
    await writeFile(target, "unchanged\n");
    const pending = await prepareReviewChange({ ...opts(), operation: "write", filePath: target });
    const finalized = await finalizeReviewChange(dataDir, pending, await readFile(target));
    expect(finalized).toEqual({ kind: "skipped", reason: "unchanged" });
    // The snapshot directory is removed on skip.
    await expect(readFile(join(dataDir, "review-changes", "session-1", pending.snapshotId, "meta.json"))).rejects.toThrow();
  });

  it("marks oversized previous content truncated and not reversible", async () => {
    const target = join(workspace, "big.txt");
    await writeFile(target, "x".repeat(REVIEW_MAX_RETAINED_BYTES + 10));
    const pending = await prepareReviewChange({ ...opts(), operation: "write", filePath: target });
    await writeFile(target, "small\n");
    const finalized = await finalizeReviewChange(dataDir, pending, await readFile(target));
    expect(finalized.kind).toBe("record");
    if (finalized.kind !== "record") return;
    expect(finalized.record.truncated).toBe(true);
    expect(finalized.record.reversible).toBe(false);
    expect(finalized.record.hunks).toBeUndefined();
  });
});

describe("rollback", () => {
  it("restores previous bytes for a modification", async () => {
    const target = join(workspace, "r.txt");
    await writeFile(target, "before\n");
    const pending = await prepareReviewChange({ ...opts(), operation: "edit", filePath: target });
    await writeFile(target, "after\n");
    await finalizeReviewChange(dataDir, pending, await readFile(target));

    const result = await rollbackReviewChange({ dataDir, sessionId: "session-1", snapshotId: pending.snapshotId });
    expect(result.kind).toBe("rolledBack");
    expect(await readFile(target, "utf8")).toBe("before\n");
  });

  it("removes a file the message created", async () => {
    const target = join(workspace, "created.txt");
    const pending = await prepareReviewChange({ ...opts(), operation: "write", filePath: target });
    await writeFile(target, "created\n");
    await finalizeReviewChange(dataDir, pending, await readFile(target));

    const result = await rollbackReviewChange({ dataDir, sessionId: "session-1", snapshotId: pending.snapshotId });
    expect(result.kind).toBe("rolledBack");
    await expect(readFile(target)).rejects.toThrow();
  });

  it("refuses to overwrite later edits (conflict)", async () => {
    const target = join(workspace, "later.txt");
    await writeFile(target, "v0\n");
    const pending = await prepareReviewChange({ ...opts(), operation: "write", filePath: target });
    await writeFile(target, "v1\n");
    await finalizeReviewChange(dataDir, pending, await readFile(target));
    // Someone edits the file after the tool.
    await writeFile(target, "v2\n");

    const result = await rollbackReviewChange({ dataDir, sessionId: "session-1", snapshotId: pending.snapshotId });
    expect(result.kind).toBe("conflict");
    expect(await readFile(target, "utf8")).toBe("v2\n");
  });

  it("reports notFound for unknown snapshots and other sessions", async () => {
    expect(await rollbackReviewChange({ dataDir, sessionId: "session-1", snapshotId: "nope" })).toEqual({ kind: "notFound" });
  });

  it("reports unavailable for a second rollback (idempotence)", async () => {
    const target = join(workspace, "twice.txt");
    const pending = await prepareReviewChange({ ...opts(), operation: "write", filePath: target });
    await writeFile(target, "x\n");
    await finalizeReviewChange(dataDir, pending, await readFile(target));
    expect((await rollbackReviewChange({ dataDir, sessionId: "session-1", snapshotId: pending.snapshotId })).kind).toBe("rolledBack");
    const second = await rollbackReviewChange({ dataDir, sessionId: "session-1", snapshotId: pending.snapshotId });
    expect(second.kind).toBe("unavailable");
  });
});

describe("removeSessionReviewStore", () => {
  it("removes the whole session store", async () => {
    const target = join(workspace, "gone.txt");
    const pending = await prepareReviewChange({ ...opts(), operation: "write", filePath: target });
    await writeFile(target, "gone\n");
    await finalizeReviewChange(dataDir, pending, await readFile(target));
    await removeSessionReviewStore(dataDir, "session-1");
    await expect(readFile(join(sessionReviewDir(dataDir, "session-1"), "x"))).rejects.toThrow();
  });
});
