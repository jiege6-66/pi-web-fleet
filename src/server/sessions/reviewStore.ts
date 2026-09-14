/**
 * Review snapshots — capture the pre-edit bytes of a workspace file so a
 * message's change can be inspected and, when safe, rolled back.
 *
 * Semantics follow PI-Desktop ADR 0043 (message-owned review snapshots):
 * - A snapshot is captured BEFORE a successful workspace `write`/`edit` tool
 *   runs and stored OUTSIDE the workspace, session-owned:
 *   `<dataDir>/review-changes/<sessionId>/<snapshotId>/{before,meta.json}`.
 * - After the tool settles, a bounded `details.review` record rides the tool
 *   result; the browser renders it beside the owning tool row.
 * - Rollback is guarded: it only restores when the current file bytes match
 *   the post-tool hash recorded in the snapshot; a mismatch returns
 *   `conflict` and leaves the file untouched (never overwrite later work).
 * - Storage is bounded: oversized previous content is omitted (hunks and
 *   rollback unavailable) while status/count metadata still records.
 *
 * This module is pure filesystem + hashing; it knows nothing about Pi or
 * Fastify so it can be unit-tested directly.
 */

import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** Status of the change a review record describes. */
export type ReviewChangeStatus = "added" | "modified" | "deleted";

/** Lifecycle state of the change from the transcript's point of view. */
export type ReviewChangeState = "active" | "rolledBack";

/** One rendered diff hunk line. */
export interface ReviewDiffHunkLine {
  kind: "context" | "add" | "remove";
  oldLine?: number;
  newLine?: number;
  text: string;
}

/** One contiguous hunk of a file diff. */
export interface ReviewDiffHunk {
  oldStart: number;
  newStart: number;
  lines: ReviewDiffHunkLine[];
}

/** The bounded review record carried in a tool result's `details.review`. */
export interface ReviewChangeRecord {
  snapshotId: string;
  /** Session id that owns the snapshot; rollback is unavailable from other sessions. */
  sessionId: string;
  /** Workspace-relative (or absolute when outside a workspace) file path. */
  path: string;
  operation: "write" | "edit";
  status: ReviewChangeStatus;
  state: ReviewChangeState;
  additions: number;
  deletions: number;
  /** Hunks are omitted when the previous/next content exceeded the bound. */
  hunks?: ReviewDiffHunk[];
  /** False when rollback cannot be attempted (e.g. content bound exceeded). */
  reversible: boolean;
  /** True when the previous or next content exceeded the retained bound. */
  truncated: boolean;
  capturedAt: string;
}

/** What `prepareReviewChange` needs to know before the tool runs. */
export interface PrepareReviewChangeInput {
  dataDir: string;
  sessionId: string;
  operation: "write" | "edit";
  /** Resolved absolute path of the file the tool will touch. */
  filePath: string;
  /** Directory the record's display path is computed against. */
  workspaceRoot: string;
  /** Optional clock seam for tests. */
  now?: () => Date;
  /** Optional id seam for tests. */
  createSnapshotId?: () => string;
}

/** A pending snapshot, held between `prepare` and `finalize`. */
export interface PendingReviewChange {
  snapshotId: string;
  sessionId: string;
  operation: "write" | "edit";
  absolutePath: string;
  relativePath: string;
  dir: string;
  /** True when the file existed before the tool (added vs modified/deleted). */
  fileExisted: boolean;
  beforeMode?: number;
  /** True when the previous content exceeded the retention bound. */
  beforeTruncated: boolean;
  capturedAt: string;
}

/** Outcome of `finalizeReviewChange` after a tool settles. */
export type FinalizeReviewChangeResult =
  | { kind: "record"; record: ReviewChangeRecord }
  | { kind: "skipped"; reason: "unchanged" };

/** Rollback outcome. */
export type RollbackReviewChangeResult =
  | { kind: "rolledBack"; record: ReviewChangeRecord }
  | { kind: "conflict"; detail: string }
  | { kind: "notFound" }
  | { kind: "unavailable"; detail: string };

/** Per-file bound on retained content: above this, hunks/rollback are omitted. */
export const REVIEW_MAX_RETAINED_BYTES = 512 * 1024;

export function sessionReviewDir(dataDir: string, sessionId: string): string {
  return join(dataDir, "review-changes", safeComponent(sessionId));
}

function snapshotDir(dataDir: string, sessionId: string, snapshotId: string): string {
  return join(sessionReviewDir(dataDir, sessionId), safeComponent(snapshotId));
}

/** Reject path components that could escape the review store. */
function safeComponent(value: string): string {
  if (value === "" || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error(`Unsafe review storage path component: ${JSON.stringify(value)}`);
  }
  return value;
}

function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Relative path against the workspace root; absolute when outside it. */
export function reviewRelativePath(workspaceRoot: string, filePath: string): string {
  const root = resolve(workspaceRoot);
  const target = resolve(filePath);
  if (target === root) return ".";
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return target.startsWith(prefix) ? target.slice(prefix.length).split(sep).join("/") : target;
}

/**
 * Capture the pre-tool state of `filePath`. Never throws for a missing file
 * (that is an `added` change); storage failures propagate to the caller.
 */
export async function prepareReviewChange(input: PrepareReviewChangeInput): Promise<PendingReviewChange> {
  const now = input.now ?? (() => new Date());
  const createSnapshotId = input.createSnapshotId ?? (() => randomUUID());
  const snapshotId = safeComponent(createSnapshotId());
  const absolutePath = resolve(input.filePath);
  const relativePath = reviewRelativePath(input.workspaceRoot, absolutePath);

  let beforeBytes: Buffer | undefined;
  let fileExisted = false;
  let beforeMode: number | undefined;
  let beforeTruncated = false;
  try {
    const info = await stat(absolutePath);
    if (info.isFile()) {
      fileExisted = true;
      beforeMode = info.mode & 0o777;
      if (info.size <= REVIEW_MAX_RETAINED_BYTES) {
        beforeBytes = await readFile(absolutePath);
      } else {
        beforeTruncated = true;
      }
    }
  } catch {
    fileExisted = false;
  }

  const dir = snapshotDir(input.dataDir, input.sessionId, snapshotId);
  await mkdir(dir, { recursive: true });
  if (beforeBytes !== undefined) {
    await writeFile(join(dir, "before"), beforeBytes);
  }

  return {
    snapshotId,
    sessionId: input.sessionId,
    operation: input.operation,
    absolutePath,
    relativePath,
    dir,
    fileExisted,
    ...(beforeMode === undefined ? {} : { beforeMode }),
    beforeTruncated,
    capturedAt: now().toISOString(),
  };
}

interface StoredReviewMeta {
  snapshotId: string;
  sessionId: string;
  absolutePath: string;
  relativePath: string;
  operation: "write" | "edit";
  capturedAt: string;
  hadBefore: boolean;
  beforeMode?: number;
  beforeRetained: boolean;
  postHash: string | null;
  state: ReviewChangeState;
  additions: number;
  deletions: number;
}

/**
 * Record the post-tool state and persist the snapshot meta. Returns a `record`
 * for the tool result, or `skipped` when the content did not change. `nextBytes`
 * is undefined when the tool deleted the file.
 */
export async function finalizeReviewChange(
  dataDir: string,
  pending: PendingReviewChange,
  nextBytes: Buffer | undefined,
): Promise<FinalizeReviewChangeResult> {
  const beforeBytes = pending.beforeTruncated ? undefined : await readBeforeBytes(pending.dir);

  if (nextBytes !== undefined && beforeBytes !== undefined && nextBytes.equals(beforeBytes)) {
    await rm(pending.dir, { recursive: true, force: true });
    return { kind: "skipped", reason: "unchanged" };
  }

  const nextHash = nextBytes === undefined ? null : hashBytes(nextBytes);
  const status: ReviewChangeStatus = !pending.fileExisted ? "added" : nextBytes === undefined ? "deleted" : "modified";
  const { hunks, additions, deletions, truncated } = summarizeDiff(beforeBytes, nextBytes, pending.beforeTruncated);

  const record: ReviewChangeRecord = {
    snapshotId: pending.snapshotId,
    sessionId: pending.sessionId,
    path: pending.relativePath,
    operation: pending.operation,
    status,
    state: "active",
    additions,
    deletions,
    ...(hunks === undefined ? {} : { hunks }),
    reversible: !pending.beforeTruncated,
    truncated: pending.beforeTruncated || truncated,
    capturedAt: pending.capturedAt,
  };

  const meta: StoredReviewMeta = {
    snapshotId: pending.snapshotId,
    sessionId: pending.sessionId,
    absolutePath: pending.absolutePath,
    relativePath: pending.relativePath,
    operation: pending.operation,
    capturedAt: pending.capturedAt,
    hadBefore: pending.fileExisted && !pending.beforeTruncated,
    ...(pending.beforeMode === undefined ? {} : { beforeMode: pending.beforeMode }),
    beforeRetained: !pending.beforeTruncated,
    postHash: nextHash,
    state: "active",
    additions,
    deletions,
  };
  await writeFile(join(pending.dir, "meta.json"), `${JSON.stringify(meta)}\n`, "utf8");
  return { kind: "record", record };
}

async function readBeforeBytes(dir: string): Promise<Buffer | undefined> {
  try {
    return await readFile(join(dir, "before"));
  } catch {
    return undefined;
  }
}

async function readStoredMeta(dataDir: string, sessionId: string, snapshotId: string): Promise<StoredReviewMeta | undefined> {
  try {
    const raw = await readFile(join(snapshotDir(dataDir, sessionId, snapshotId), "meta.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isStoredReviewMeta(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Narrow an unknown parsed value to a stored meta record (defensive against edits). */
function isStoredReviewMeta(value: unknown): value is StoredReviewMeta {
  if (!isRecord(value)) return false;
  return (
    typeof value["snapshotId"] === "string" &&
    typeof value["sessionId"] === "string" &&
    typeof value["absolutePath"] === "string" &&
    typeof value["relativePath"] === "string" &&
    (value["operation"] === "write" || value["operation"] === "edit") &&
    typeof value["capturedAt"] === "string" &&
    typeof value["hadBefore"] === "boolean" &&
    (value["beforeMode"] === undefined || (typeof value["beforeMode"] === "number" && Number.isInteger(value["beforeMode"]) && value["beforeMode"] >= 0 && value["beforeMode"] <= 0o777)) &&
    typeof value["beforeRetained"] === "boolean" &&
    (value["postHash"] === null || typeof value["postHash"] === "string") &&
    (value["state"] === "active" || value["state"] === "rolledBack") &&
    typeof value["additions"] === "number" &&
    typeof value["deletions"] === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Guarded rollback: only restore when the current file matches the post-tool
 * hash; otherwise `conflict`. An `added` change removes the file; other
 * changes restore the retained `before` bytes.
 */
export async function rollbackReviewChange(input: { dataDir: string; sessionId: string; snapshotId: string }): Promise<RollbackReviewChangeResult> {
  const meta = await readStoredMeta(input.dataDir, input.sessionId, input.snapshotId);
  if (meta === undefined) return { kind: "notFound" };
  if (meta.state === "rolledBack") return { kind: "unavailable", detail: "Change was already rolled back." };
  if (!meta.beforeRetained) return { kind: "unavailable", detail: "Previous content was not retained (too large); rollback is unavailable." };

  const current = await readFileSafely(meta.absolutePath);
  const currentHash = current === undefined ? null : hashBytes(current);
  if (meta.postHash === null) {
    if (current !== undefined) {
      return { kind: "conflict", detail: "This change created the file; it has since been modified." };
    }
  } else if (currentHash !== meta.postHash) {
    return { kind: "conflict", detail: "The file changed since this tool ran; refusing to overwrite later work." };
  }

  if (!meta.hadBefore) {
    await rm(meta.absolutePath, { force: true });
  } else {
    const dir = snapshotDir(input.dataDir, input.sessionId, input.snapshotId);
    let retained: Buffer;
    try {
      retained = await readFile(join(dir, "before"));
    } catch {
      return { kind: "unavailable", detail: "Retained previous content is missing from the snapshot store." };
    }
    await mkdir(dirname(meta.absolutePath), { recursive: true });
    const temp = `${meta.absolutePath}.review-rollback-${randomUUID()}.tmp`;
    // Old snapshots have no mode: preserve the current mode, or fail safe
    // to owner-only access if the target was deleted. Never default to 0644.
    const mode = meta.beforeMode ?? (await stat(meta.absolutePath).catch(() => undefined))?.mode;
    try {
      await writeFile(temp, retained, { flag: "wx", mode: 0o600 });
      await chmod(temp, mode === undefined ? 0o600 : mode & 0o777);
      await rename(temp, meta.absolutePath);
    } finally {
      await rm(temp, { force: true });
    }
  }

  meta.state = "rolledBack";
  await writeFile(join(snapshotDir(input.dataDir, input.sessionId, input.snapshotId), "meta.json"), `${JSON.stringify(meta)}\n`, "utf8");
  return {
    kind: "rolledBack",
    record: {
      snapshotId: meta.snapshotId,
      sessionId: meta.sessionId,
      path: meta.relativePath,
      operation: meta.operation,
      status: meta.hadBefore ? "modified" : "added",
      state: "rolledBack",
      additions: meta.additions,
      deletions: meta.deletions,
      reversible: false,
      truncated: false,
      capturedAt: meta.capturedAt,
    },
  };
}

async function readFileSafely(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch {
    return undefined;
  }
}

/** Line-level diff summary sized for inline review cards. */
function summarizeDiff(
  before: Buffer | undefined,
  next: Buffer | undefined,
  beforeTruncated: boolean,
): { hunks: ReviewDiffHunk[] | undefined; additions: number; deletions: number; truncated: boolean } {
  if (beforeTruncated || next === undefined || next.length > REVIEW_MAX_RETAINED_BYTES) {
    return { hunks: undefined, additions: 0, deletions: 0, truncated: true };
  }
  if (before === undefined) {
    // Added file: every next line is an addition.
    const nextLines = next.toString("utf8").split("\n");
    const lines: ReviewDiffHunkLine[] = nextLines.map((text, index) => ({ kind: "add" as const, newLine: index + 1, text }));
    return {
      hunks: [{ oldStart: 0, newStart: 1, lines }],
      additions: nextLines.length,
      deletions: 0,
      truncated: false,
    };
  }
  const beforeLines = before.toString("utf8").split("\n");
  const nextLines = next.toString("utf8").split("\n");
  return diffLineHunks(beforeLines, nextLines);
}

/** Trim equal prefix/suffix, emit one hunk for the changed middle. */
function diffLineHunks(beforeLines: string[], nextLines: string[]): { hunks: ReviewDiffHunk[]; additions: number; deletions: number; truncated: boolean } {
  let prefix = 0;
  const maxPrefix = Math.min(beforeLines.length, nextLines.length);
  while (prefix < maxPrefix && beforeLines[prefix] === nextLines[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = Math.min(beforeLines.length, nextLines.length) - prefix;
  while (
    suffix < maxSuffix &&
    beforeLines[beforeLines.length - 1 - suffix] === nextLines[nextLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const removed = beforeLines.slice(prefix, beforeLines.length - suffix);
  const added = nextLines.slice(prefix, nextLines.length - suffix);
  const contextBefore = Math.max(0, prefix - 3);
  const contextAfter = Math.min(3, suffix);

  const lines: ReviewDiffHunkLine[] = [];
  for (let index = contextBefore; index < prefix; index += 1) {
    lines.push({ kind: "context", oldLine: index + 1, newLine: index + 1, text: beforeLines[index] ?? "" });
  }
  for (let index = 0; index < removed.length; index += 1) {
    lines.push({ kind: "remove", oldLine: prefix + index + 1, text: removed[index] ?? "" });
  }
  for (let index = 0; index < added.length; index += 1) {
    lines.push({ kind: "add", newLine: prefix + index + 1, text: added[index] ?? "" });
  }
  const afterStart = beforeLines.length - suffix;
  for (let index = 0; index < contextAfter; index += 1) {
    lines.push({
      kind: "context",
      oldLine: afterStart + index + 1,
      newLine: nextLines.length - suffix + index + 1,
      text: beforeLines[afterStart + index] ?? "",
    });
  }

  const hunks: ReviewDiffHunk[] = lines.length === 0 ? [] : [{ oldStart: contextBefore + 1, newStart: contextBefore + 1, lines }];
  return { hunks, additions: added.length, deletions: removed.length, truncated: false };
}

/** Remove a session's whole review store (session deletion / cleanup path). */
export async function removeSessionReviewStore(dataDir: string, sessionId: string): Promise<void> {
  await rm(sessionReviewDir(dataDir, sessionId), { recursive: true, force: true });
}
