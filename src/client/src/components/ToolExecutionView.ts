import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { parseReviewChangeRecord } from "../api/parsers";
import { writeClipboardText } from "../clipboard";
import { isSnapshotRolledBack, recordRolledBackSnapshot } from "../reviewState";
import type { ReviewChangeRecord, ReviewDiffHunk, RollbackReviewChangeResult } from "../../../shared/apiTypes";
import { I18nController, t } from "../i18n";
import type { ToolExecutionPart } from "./shared";

const MAX_COLLAPSED_DIFF_LINES = 180;

interface ToolTarget {
  labelKey: "chat.targetCommand" | "chat.targetFile" | "chat.targetInput";
  fallback: "Command" | "File" | "Input";
  text: string;
}

@customElement("tool-execution-view")
export class ToolExecutionView extends LitElement {
  @property({ attribute: false }) execution: ToolExecutionPart | undefined;
  @property({ type: Boolean }) rolledBack = false;
  @property({ attribute: false }) onRollbackReview?: (snapshotId: string) => Promise<RollbackReviewChangeResult | undefined>;
  @state() private showFullDiff = false;
  @state() private copied = false;
  @state() private diffOpen = true;
  @state() private localRolledBack = false;
  @state() private isRollingBack = false;
  @state() private rollbackError: string | undefined;
  @state() private rollbackDetail: string | undefined;
  private readonly i18n = new I18nController(this);

  override render() {
    const execution = this.execution;
    if (execution === undefined) return null;

    const path = pathFromArgs(execution.args);
    const actualDiff = diffFromDetails(execution.details);
    const preview = execution.preview;
    const visibleDiff = actualDiff ?? preview?.diff;
    const diffStats = visibleDiff === undefined ? undefined : countDiffLines(visibleDiff);
    const previewMismatch = actualDiff !== undefined && preview?.diff !== undefined && actualDiff !== preview.diff;
    const errorText = execution.status === "error" ? execution.resultText : preview?.error;
    const bodyText = visibleDiff === undefined ? execution.resultText : undefined;
    const target = toolTarget(execution, path);

    return html`
      <section class=${`tool-card ${execution.status}`}>
        <div class="tool-header">
          <div class="tool-title">
            <span class="status-icon" aria-hidden="true">${statusIcon(execution.status)}</span>
            <strong>${execution.toolName}</strong>
            ${this.renderHeaderTarget(target)}
          </div>
          <div class="tool-meta">
            ${editCountLabel(execution) === undefined ? null : html`<span>${editCountLabel(execution)}</span>`}
            ${diffStats === undefined ? null : html`<span class="diff-stats"><b class="added">+${diffStats.added}</b><span>/</span><b class="removed">-${diffStats.removed}</b></span>`}
            <span class="status-label">${statusLabel(execution.status)}</span>
          </div>
        </div>

        ${previewMismatch ? html`<p class="notice">${t("chat.previewMismatch")}</p>` : null}
        ${errorText === undefined || errorText === "" ? null : html`<pre class="error-text">${errorText}</pre>`}
        ${visibleDiff === undefined ? this.renderTextBody(bodyText, execution.status === "error", target) : this.renderDiffBody(visibleDiff, actualDiff === undefined ? t("chat.previewDiff") : t("chat.appliedDiff"), target)}
        ${this.renderReviewCard(execution)}
      </section>
    `;
  }

  private renderHeaderTarget(target: ToolTarget | undefined) {
    if (target === undefined) return null;
    const className = target.fallback === "File" ? "path" : "summary";
    const label = t(target.labelKey);
    return html`<span class=${className} title=${target.text} aria-label=${`${label}: ${target.text}`}>${target.text}</span>`;
  }

  private renderExpandedTarget(target: ToolTarget | undefined) {
    if (target === undefined) return null;
    return html`
      <div class="detail-target">
        <span class="detail-label">${t(target.labelKey)}</span>
        <pre class="detail-target-value">${target.text}</pre>
      </div>
    `;
  }

  private renderTextBody(text: string | undefined, open: boolean, target: ToolTarget | undefined) {
    if ((text === undefined || text === "") && target === undefined) return null;
    return html`
      <details class="text-body" ?open=${open}>
        <summary>${t("common.details")}</summary>
        ${this.renderExpandedTarget(target)}
        ${text === undefined || text === "" ? null : html`
          <div class="detail-result">
            <span class="detail-label">${t("common.result")}</span>
            <pre>${text}</pre>
          </div>
        `}
      </details>
    `;
  }

  private renderDiffBody(diff: string, label: string, target: ToolTarget | undefined) {
    const lines = diff.split("\n");
    const truncated = !this.showFullDiff && lines.length > MAX_COLLAPSED_DIFF_LINES;
    const visibleLines = truncated ? lines.slice(0, MAX_COLLAPSED_DIFF_LINES) : lines;
    return html`
      <details class="diff-details" ?open=${this.diffOpen} @toggle=${(event: Event) => { this.onDiffToggle(event); }}>
        <summary>
          <span>${label}</span>
          <small>${lines.length === 1 ? t("chat.diffLineCount", { count: lines.length }) : t("chat.diffLinesCount", { count: lines.length })}</small>
        </summary>
        ${this.renderExpandedTarget(target)}
        <div class="diff-toolbar">
          <span>${truncated ? t("chat.showingDiffLines", { visible: visibleLines.length, total: lines.length }) : t("chat.fullDiff")}</span>
          <button type="button" @click=${() => { void this.copyDiff(diff); }}>${this.copied ? t("chat.copied") : t("chat.copyDiff")}</button>
        </div>
        <pre class="diff" aria-label=${label}><code class="diff-content">${visibleLines.map((line) => html`<span class=${diffLineClass(line)}>${line}</span>`)}</code></pre>
        ${truncated ? html`
          <button class="show-more" type="button" @click=${() => { this.showFullDiff = true; }}>
            ${t("chat.showAllDiffLines", { total: lines.length })}
          </button>
        ` : null}
      </details>
    `;
  }

  private onDiffToggle(event: Event): void {
    const details = event.currentTarget;
    if (details instanceof HTMLDetailsElement) this.diffOpen = details.open;
  }

  private async copyDiff(diff: string): Promise<void> {
    const copied = await writeClipboardText(diff);
    if (!copied) {
      this.copied = false;
      return;
    }
    this.copied = true;
    window.setTimeout(() => { this.copied = false; }, 1200);
  }

  private renderReviewCard(execution: ToolExecutionPart) {
    if (execution.toolName !== "write" && execution.toolName !== "edit") return null;
    const review = reviewFromDetails(execution.details);
    if (review === undefined) return null;

    const isRolledBack = this.rolledBack || this.localRolledBack || review.state === "rolledBack" || isSnapshotRolledBack(review.snapshotId);
    const hunkCount = review.hunks?.length ?? 0;
    const totalDiffLines = review.hunks?.reduce((acc, h) => acc + h.lines.length, 0) ?? 0;

    return html`
      <div class="review-card" data-snapshot-id=${review.snapshotId}>
        <div class="review-header">
          <div class="review-title">
            <span class="review-badge">${t("chat.review")}</span>
            <span class="review-path" title=${review.path} aria-label=${`File: ${review.path}`}>${review.path}</span>
            <span class=${`review-status-badge ${review.status}`}>${t(`review.${review.status}`)}</span>
          </div>
          <div class="review-actions">
            <span class="diff-stats">
              <b class="added">+${String(review.additions)}</b>
              <span>/</span>
              <b class="removed">−${String(review.deletions)}</b>
            </span>
            ${this.renderRollbackButton(review, isRolledBack)}
          </div>
        </div>

        ${review.truncated ? html`<p class="review-notice">${t("review.truncated")}</p>` : null}
        ${this.rollbackError !== undefined ? html`<p class="review-error" role="alert" title=${this.rollbackDetail ?? ""}>${this.rollbackError}</p>` : null}

        ${review.hunks !== undefined && review.hunks.length > 0 ? html`
          <details class="review-hunks-details">
            <summary>
              <span>${t("chat.changes")}</span>
              <small>${t("review.lines", { count: totalDiffLines })}${hunkCount > 1 ? t("review.hunks", { count: hunkCount }) : ""}</small>
            </summary>
            <div class="review-hunk-lines">
              ${review.hunks.map((hunk) => this.renderHunk(hunk))}
            </div>
          </details>
        ` : null}
      </div>
    `;
  }

  private renderRollbackButton(review: ReviewChangeRecord, isRolledBack: boolean) {
    if (isRolledBack) {
      return html`<button type="button" class="rollback-button" disabled>${t("chat.rolledBack")}</button>`;
    }
    if (this.isRollingBack) {
      return html`<button type="button" class="rollback-button" disabled>${t("chat.rollingBack")}</button>`;
    }
    if (!review.reversible) {
      return html`<button type="button" class="rollback-button" disabled title=${t("chat.rollbackUnavailable")}>${t("chat.rollback")}</button>`;
    }
    return html`<button type="button" class="rollback-button" @click=${() => { void this.handleRollback(review); }}>${t("chat.rollback")}</button>`;
  }

  private renderHunk(hunk: ReviewDiffHunk) {
    return html`
      <div class="review-hunk">
        <div class="review-hunk-header">@@ -${String(hunk.oldStart)} +${String(hunk.newStart)} @@</div>
        ${hunk.lines.map((line) => {
          const marker = line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " ";
          return html`
            <div class=${`review-line ${line.kind}`}>
              <span class="line-num old-num">${line.oldLine !== undefined ? String(line.oldLine) : ""}</span>
              <span class="line-num new-num">${line.newLine !== undefined ? String(line.newLine) : ""}</span>
              <span class="line-marker">${marker}</span>
              <span class="line-text">${line.text}</span>
            </div>
          `;
        })}
      </div>
    `;
  }

  private async handleRollback(review: ReviewChangeRecord): Promise<void> {
    if (this.isRollingBack) return;
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const confirmed = window.confirm(t("review.confirm", { path: review.path }));
      if (!confirmed) return;
    }
    const callback = this.onRollbackReview;
    if (callback === undefined) return;
    this.isRollingBack = true;
    this.rollbackError = undefined;
    this.rollbackDetail = undefined;
    try {
      const result = await callback(review.snapshotId);
      if (result !== undefined) {
        this.rollbackDetail = "detail" in result ? result.detail : undefined;
        switch (result.kind) {
          case "rolledBack":
            this.localRolledBack = true;
            recordRolledBackSnapshot(review.snapshotId);
            break;
          case "conflict":
            this.rollbackError = t("review.conflict");
            break;
          case "unavailable":
            this.rollbackError = t("review.unavailable");
            break;
          case "notFound":
            this.rollbackError = t("review.notFound");
            break;
        }
      }
    } catch (error) {
      this.rollbackError = error instanceof Error ? error.message : "Rollback failed";
    } finally {
      this.isRollingBack = false;
    }
  }

  static override styles = css`
    :host { display: block; width: 100%; max-width: 100%; min-width: 0; color: var(--pi-text); }
    .tool-card { display: grid; gap: 8px; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; overflow: hidden; border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-bg); padding: 9px; color: var(--pi-text); }
    .tool-card.running, .tool-card.pending { border-color: var(--pi-warning-border); background: var(--pi-warning-surface); }
    .tool-card.success { border-color: var(--pi-success-border); background: var(--pi-success-bg); }
    .tool-card.error { border-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-bg)); }
    .tool-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; min-width: 0; }
    .tool-title { flex: 1 1 auto; display: inline-flex; align-items: baseline; gap: 7px; min-width: 0; }
    .status-icon { flex: 0 0 auto; color: var(--pi-muted); }
    strong { flex: 0 0 auto; color: var(--pi-text); }
    .path, .summary { display: block; flex: 1 1 auto; min-width: 0; max-width: 100%; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; white-space: pre; color: var(--pi-accent); font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; direction: ltr; text-align: left; unicode-bidi: isolate; }
    .summary { color: var(--pi-muted); font-family: inherit; }
    .tool-meta { flex: 0 0 auto; display: inline-flex; align-items: baseline; gap: 8px; color: var(--pi-muted); font-size: 12px; }
    .diff-stats { display: inline-flex; gap: 3px; }
    .added, .diff .added { color: var(--pi-success); }
    .removed, .diff .removed { color: var(--pi-danger); }
    .status-label { text-transform: uppercase; letter-spacing: .04em; color: var(--pi-muted); }
    .notice { margin: 0; color: var(--pi-warning); }
    .muted { margin: 0; color: var(--pi-muted); }
    .error-text { margin: 0; border: 1px solid var(--pi-danger); border-radius: 7px; background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-bg)); color: var(--pi-danger); padding: 8px; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .text-body { border-top: 1px solid var(--pi-border-muted); padding-top: 6px; }
    .detail-target, .detail-result { display: grid; gap: 4px; margin-top: 8px; min-width: 0; }
    .detail-label { color: var(--pi-muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .text-body pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--pi-text); }
    .detail-result pre { box-sizing: border-box; max-width: 100%; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; border: 1px solid var(--pi-border-muted); border-radius: 7px; background: var(--pi-bg); padding: 8px; white-space: pre; overflow-wrap: normal; direction: ltr; text-align: left; unicode-bidi: isolate; }
    .detail-target-value { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--pi-accent); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; direction: ltr; text-align: left; unicode-bidi: isolate; }
    .diff-details { min-width: 0; max-width: 100%; border-top: 1px solid var(--pi-border-muted); padding-top: 6px; }
    .diff-details > summary { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; color: var(--pi-muted); cursor: pointer; }
    .diff-details > summary span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .diff-details > summary small { flex: 0 0 auto; color: var(--pi-dim); }
    .diff-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; margin-top: 8px; color: var(--pi-muted); font-size: 12px; }
    .diff-toolbar span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    button { border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-text); padding: 3px 7px; font: 12px system-ui, sans-serif; cursor: pointer; }
    button:hover, button:focus { border-color: var(--pi-accent); }
    .diff { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; margin: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; border: 1px solid var(--pi-border-muted); border-radius: 7px; background: var(--pi-bg); padding: 8px 0; color: var(--pi-muted); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; }
    .diff-content { display: block; width: max-content; min-width: 100%; }
    .diff span { display: block; min-height: 1.45em; padding: 0 8px; white-space: pre; }
    .diff .context { color: var(--pi-muted); }
    .diff .hunk { color: var(--pi-accent); }
    .diff .file { color: var(--pi-dim); }
    .diff .meta { color: var(--pi-dim); }
    .diff .added { background: color-mix(in srgb, var(--pi-success) 12%, transparent); }
    .diff .removed { background: color-mix(in srgb, var(--pi-danger) 12%, transparent); }
    .show-more { justify-self: start; }
    .review-card { display: grid; gap: 8px; margin-top: 8px; border: 1px solid var(--pi-border-muted); border-radius: 7px; background: var(--pi-surface, rgba(0, 0, 0, 0.02)); padding: 8px 10px; }
    .review-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    .review-title { display: inline-flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
    .review-badge { flex: 0 0 auto; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; padding: 1px 5px; border-radius: 4px; background: var(--pi-surface-muted, var(--pi-border)); color: var(--pi-muted); }
    .review-path { font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--pi-accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .review-status-badge { flex: 0 0 auto; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; padding: 1px 6px; border-radius: 4px; }
    .review-status-badge.added { color: var(--pi-success); background: color-mix(in srgb, var(--pi-success) 14%, transparent); }
    .review-status-badge.modified { color: var(--pi-accent); background: color-mix(in srgb, var(--pi-accent) 14%, transparent); }
    .review-status-badge.deleted { color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 14%, transparent); }
    .review-actions { display: inline-flex; align-items: center; gap: 10px; flex: 0 0 auto; }
    .rollback-button { border: 1px solid var(--pi-border); border-radius: 6px; background: var(--pi-surface); color: var(--pi-text); padding: 3px 8px; font: 12px system-ui, sans-serif; cursor: pointer; }
    .rollback-button:hover:not(:disabled) { border-color: var(--pi-accent); }
    .rollback-button:disabled { opacity: 0.6; cursor: not-allowed; }
    .review-notice { margin: 0; color: var(--pi-warning); font-size: 12px; }
    .review-error { margin: 0; border: 1px solid var(--pi-danger); border-radius: 6px; background: color-mix(in srgb, var(--pi-danger) 10%, var(--pi-bg)); color: var(--pi-danger); padding: 6px 8px; font-size: 12px; }
    .review-hunks-details { border-top: 1px solid var(--pi-border-muted); padding-top: 6px; }
    .review-hunks-details > summary { color: var(--pi-muted); cursor: pointer; font-size: 12px; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .review-hunk-lines { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; margin: 8px 0 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; border: 1px solid var(--pi-border-muted); border-radius: 6px; background: var(--pi-bg); padding: 6px 0; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; }
    .review-hunk { display: grid; }
    .review-hunk:not(:first-child) { margin-top: 6px; border-top: 1px dashed var(--pi-border-muted); padding-top: 6px; }
    .review-hunk-header { padding: 2px 8px; color: var(--pi-accent); font-size: 11px; user-select: none; }
    .review-line { display: flex; min-height: 1.45em; padding: 0 8px; white-space: pre; }
    .review-line.context { color: var(--pi-muted); }
    .review-line.add { color: var(--pi-success); background: color-mix(in srgb, var(--pi-success) 12%, transparent); }
    .review-line.remove { color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 12%, transparent); }
    .review-line .line-num { display: inline-block; width: 32px; text-align: right; padding-right: 6px; color: var(--pi-dim); user-select: none; font-size: 11px; flex: 0 0 auto; }
    .review-line .line-marker { display: inline-block; width: 14px; text-align: center; user-select: none; flex: 0 0 auto; }
    .review-line .line-text { flex: 1 1 auto; white-space: pre; }
  `;
}

function toolTarget(execution: ToolExecutionPart, path: string | undefined): ToolTarget | undefined {
  if (path !== undefined && path !== "") return { labelKey: "chat.targetFile", fallback: "File", text: path };
  const command = getString(execution.args, "command");
  if (command !== undefined && command !== "") return { labelKey: "chat.targetCommand", fallback: "Command", text: command };
  if (execution.summary !== "") return { labelKey: "chat.targetInput", fallback: "Input", text: execution.summary };
  return undefined;
}

function pathFromArgs(args: unknown): string | undefined {
  return getString(args, "path") ?? getString(args, "file_path");
}

function editCountLabel(execution: ToolExecutionPart): string | undefined {
  if (execution.toolName !== "edit") return undefined;
  const edits = getProperty(execution.args, "edits");
  if (Array.isArray(edits)) return `${String(edits.length)} edit${edits.length === 1 ? "" : "s"}`;
  if (typeof getProperty(execution.args, "oldText") === "string" && typeof getProperty(execution.args, "newText") === "string") return "1 edit";
  return undefined;
}

function diffFromDetails(details: unknown): string | undefined {
  return getString(details, "diff");
}

function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (isAddedDiffLine(line)) added++;
    else if (isRemovedDiffLine(line)) removed++;
  }
  return { added, removed };
}

function diffLineClass(line: string): string {
  if (isAddedDiffLine(line)) return "added";
  if (isRemovedDiffLine(line)) return "removed";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+++") || line.startsWith("---")) return "file";
  if (line.startsWith("diff ") || line.startsWith("index ")) return "meta";
  return "context";
}

function isAddedDiffLine(line: string): boolean {
  return line.startsWith("+") && !line.startsWith("+++");
}

function isRemovedDiffLine(line: string): boolean {
  return line.startsWith("-") && !line.startsWith("---");
}

function statusIcon(status: ToolExecutionPart["status"]): string {
  if (status === "success") return "✓";
  if (status === "error") return "✖";
  if (status === "running") return "●";
  return "○";
}

function statusLabel(status: ToolExecutionPart["status"]): string {
  if (status === "success") return "done";
  if (status === "error") return "failed";
  if (status === "running") return "running";
  return "pending";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getProperty(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function getString(value: unknown, key: string): string | undefined {
  const property = getProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

function reviewFromDetails(details: unknown): ReviewChangeRecord | undefined {
  if (!isRecord(details)) return undefined;
  const review = details["review"];
  if (!isRecord(review)) return undefined;
  try {
    return parseReviewChangeRecord(review);
  } catch {
    return undefined;
  }
}

