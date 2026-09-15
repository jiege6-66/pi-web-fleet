import type { PluginI18n, WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { tr } from "./i18n.js";
import { TASKS_CONFIG_PATH, type WorkspaceTask } from "./config.js";
import { runWorkspaceTaskInTerminal } from "./taskRunner.js";
import { loadWorkspaceTasksConfig, tasksConfigRefreshHint, tasksConfigUnavailableMessage, type WorkspaceTasksConfigLoadResult } from "./workspaceTasksClient.js";

export const tasksPanelTagName = "pi-web-workspace-tasks-panel";

const configChangedEvent = "pi-web-workspace-tasks-config-changed";

type ConfigState =
  | { kind: "loading" }
  | WorkspaceTasksConfigLoadResult;

interface TaskStatus {
  kind: "info" | "success" | "error";
  message: string;
  key?: string;
  params?: Readonly<Record<string, string | number>>;
  detail?: string;
}

const configCache = new Map<string, ConfigState>();

export function defineTasksPanelElement(): void {
  if (!customElements.get(tasksPanelTagName)) customElements.define(tasksPanelTagName, PiWebTasksPanel);
}

export function tasksPanelBadge(context: WorkspacePanelContext): string | undefined {
  const state = getCachedWorkspaceConfig(context);
  return state?.kind === "unavailable" ? "!" : undefined;
}

class PiWebTasksPanel extends HTMLElement {
  private contextValue: WorkspacePanelContext | undefined;
  private localeValue: string | undefined;
  private text(key: string, fallback: string, params?: Readonly<Record<string, string | number>>): string {
    return tr(this.contextValue?.i18n, `plugins.tasks.${key}`, fallback, params);
  }
  private runningTaskId: string | undefined;
  private status: TaskStatus | undefined;
  private readonly root: ShadowRoot;
  private readonly onConfigChanged = () => {
    this.render();
  };

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }

  set context(value: WorkspacePanelContext | undefined) {
    const previousKey = this.contextValue === undefined ? undefined : cacheKeyForContext(this.contextValue);
    const nextKey = value === undefined ? undefined : cacheKeyForContext(value);
    const localeChanged = this.localeValue !== value?.i18n?.locale;
    this.localeValue = value?.i18n?.locale;
    this.contextValue = value;
    // Cache the string: the host translation handle exposes a mutable locale getter.
    // A language-only update must not reload config or reset an in-flight dispatch.
    if (previousKey === nextKey) {
      if (localeChanged) this.render();
      return;
    }
    this.runningTaskId = undefined;
    this.status = undefined;
    this.render();
  }

  connectedCallback(): void {
    window.addEventListener(configChangedEvent, this.onConfigChanged);
    this.render();
  }

  disconnectedCallback(): void {
    window.removeEventListener(configChangedEvent, this.onConfigChanged);
  }

  private render(): void {
    const context = this.contextValue;
    if (context === undefined) {
      this.root.innerHTML = `${taskStyles()}<section class="empty">${escapeHtml(this.text("selectWorkspace", "Select a workspace."))}</section>`;
      return;
    }

    const state = getOrLoadWorkspaceConfig(context);
    this.root.innerHTML = `
      ${taskStyles()}
      <section class="toolbar">
        <strong>${escapeHtml(this.text("heading", "Workspace Tasks"))}</strong>
        <span class="toolbar-tasks">
          <button class="secondary" data-refresh-config ${state.kind === "loading" ? "disabled" : ""}>${escapeHtml(this.text("refresh", "Refresh"))}</button>
          <button class="secondary" data-open-terminal>${escapeHtml(this.text("openTerminal", "Open Terminal"))}</button>
        </span>
      </section>
      ${this.renderStatus()}
      <section class="viewer tasks-viewer">
        ${this.renderConfigState(state)}
      </section>
    `;

    this.root.querySelector("button[data-refresh-config]")?.addEventListener("click", () => {
      void this.refreshConfig(context);
    });

    for (const button of this.root.querySelectorAll("button[data-task-id]")) {
      button.addEventListener("click", () => {
        void this.dispatchTaskById(context, button.getAttribute("data-task-id"));
      });
    }

    this.root.querySelector("button[data-open-terminal]")?.addEventListener("click", () => {
      this.openWorkspaceTerminal();
    });
  }

  private dispatchTaskById(context: WorkspacePanelContext, taskId: string | null): Promise<void> {
    if (!this.isCurrentContext(context)) return Promise.resolve();
    const task = taskFromConfigState(getCachedWorkspaceConfig(context), taskId);
    if (task === undefined) {
      this.status = { kind: "error", key: "taskGone", message: "That task is no longer available. Click Refresh, then try again." };
      this.render();
      return Promise.resolve();
    }
    return this.dispatchTask(context, task);
  }

  private isCurrentContext(context: WorkspacePanelContext): boolean {
    return this.contextValue !== undefined && cacheKeyForContext(this.contextValue) === cacheKeyForContext(context);
  }

  private renderConfigState(state: ConfigState): string {
    const i18n = this.contextValue?.i18n;
    if (state.kind === "loading") return `<p class="muted">${escapeHtml(this.text("loading", "Loading {path}…", { path: TASKS_CONFIG_PATH }))}</p>`;
    if (state.kind === "missing") return renderMissingState(state, i18n);
    if (state.kind === "unavailable") return renderUnavailableState(state, i18n);

    if (state.config.tasks.length === 0) return `<p class="muted">${escapeHtml(this.text("empty", "No tasks are defined in {path}. Add tasks to the file, then click Refresh.", { path: state.path }))}</p>`;
    return `
      <p class="muted">${escapeHtml(this.text("instructions", "Tasks run in a dedicated workspace terminal, then switch to that terminal. Edit {path} and click Refresh to reload.", { path: state.path }))}</p>
      ${renderTaskGroups(state.config.tasks, this.runningTaskId, i18n)}
    `;
  }

  private renderStatus(): string {
    if (this.status === undefined) return "";
    const detail = this.status.detail === undefined ? "" : `<pre>${escapeHtml(this.status.detail)}</pre>`;
    const message = this.status.key === undefined ? this.status.message : this.text(this.status.key, this.status.message, this.status.params);
    return `<div class="status panel-status ${escapeAttr(this.status.kind)}">${escapeHtml(message)}${detail}</div>`;
  }

  private async refreshConfig(context: WorkspacePanelContext): Promise<void> {
    this.status = { kind: "info", key: "refreshing", message: "Refreshing {path}…", params: { path: TASKS_CONFIG_PATH } };
    configCache.set(cacheKeyForContext(context), { kind: "loading" });
    this.render();

    const state = await refreshWorkspaceConfig(context);
    if (!this.isCurrentContext(context)) return;
    this.status = state.kind === "loaded"
      ? { kind: "success", key: state.config.tasks.length === 1 ? "loadedOne" : "loadedMany", message: state.config.tasks.length === 1 ? "Loaded {count} task." : "Loaded {count} tasks.", params: { count: state.config.tasks.length } }
      : undefined;
    this.render();
  }

  private async dispatchTask(context: WorkspacePanelContext, task: WorkspaceTask): Promise<void> {
    if (this.runningTaskId !== undefined) {
      this.status = { kind: "info", key: "alreadyStarting", message: "Another task is already starting. Wait for it to finish dispatching, then try again." };
      this.render();
      return;
    }
    if (task.confirm && !window.confirm(this.text("confirmRun", "Run {title}?\n\n{command}", { title: task.title, command: task.command }))) {
      this.status = { kind: "info", key: "cancelled", message: "Cancelled {title}.", params: { title: task.title } };
      this.render();
      return;
    }

    this.runningTaskId = task.id;
    this.status = { kind: "info", key: "starting", message: "Starting {title}…", params: { title: task.title } };
    this.render();

    try {
      const handle = await runWorkspaceTaskInTerminal(context.terminal, task);
      if (!this.isCurrentContext(context)) return;
      this.status = {
        kind: "success", key: "started",
        message: "Started terminal command “{title}”.", params: { title: handle.run.title },
        detail: task.command,
      };
      this.runningTaskId = undefined;
      this.render();
    } catch (error) {
      if (!this.isCurrentContext(context)) return;
      this.runningTaskId = undefined;
      this.status = { kind: "error", message: error instanceof Error ? error.message : String(error) };
      this.render();
    }
  }

  private openWorkspaceTerminal(terminalId?: string): void {
    const context = this.contextValue;
    if (context === undefined) {
      this.status = { kind: "error", key: "selectBeforeTerminal", message: "Select a workspace before opening a terminal." };
      this.render();
      return;
    }
    if (terminalId === undefined) context.terminal.open();
    else context.terminal.open({ terminalId });
  }
}

function getCachedWorkspaceConfig(context: WorkspacePanelContext): ConfigState | undefined {
  return configCache.get(cacheKeyForContext(context));
}

function getOrLoadWorkspaceConfig(context: WorkspacePanelContext): ConfigState {
  const cached = getCachedWorkspaceConfig(context);
  if (cached !== undefined) return cached;

  const loading: ConfigState = { kind: "loading" };
  configCache.set(cacheKeyForContext(context), loading);
  void refreshWorkspaceConfig(context);
  return loading;
}

async function refreshWorkspaceConfig(context: WorkspacePanelContext): Promise<ConfigState> {
  const key = cacheKeyForContext(context);
  const state = await loadWorkspaceTasksConfig(context.files).catch((error: unknown): ConfigState => ({
    kind: "unavailable",
    message: tasksConfigUnavailableMessage,
    hint: tasksConfigRefreshHint,
    detail: error instanceof Error ? error.message : String(error),
  }));
  configCache.set(key, state);
  context.host.requestRender();
  window.dispatchEvent(new Event(configChangedEvent));
  return state;
}

function cacheKeyForContext(context: WorkspacePanelContext): string {
  return `${context.machine.id}:${context.workspace.projectId}:${context.workspace.id}`;
}

function renderMissingState(state: Extract<ConfigState, { kind: "missing" }>, i18n?: PluginI18n): string {
  return `<div class="empty-state"><strong>${escapeHtml(tr(i18n, "plugins.tasks.missing", state.message))}</strong><p>${escapeHtml(tr(i18n, "plugins.tasks.missingHint", state.hint, { path: TASKS_CONFIG_PATH }))}</p></div>`;
}

function renderUnavailableState(state: Extract<ConfigState, { kind: "unavailable" }>, i18n?: PluginI18n): string {
  const detail = state.detail === undefined ? "" : `<pre>${escapeHtml(state.detail)}</pre>`;
  return `<div class="status error"><strong>${escapeHtml(tr(i18n, "plugins.tasks.unavailable", state.message))}</strong><p>${escapeHtml(tr(i18n, "plugins.tasks.fixHint", state.hint, { path: TASKS_CONFIG_PATH }))}</p>${detail}</div>`;
}

function renderTaskGroups(tasks: WorkspaceTask[], runningTaskId: string | undefined, i18n?: PluginI18n): string {
  return `<div class="tasks">${groupTasks(tasks).map((group) => renderTaskGroup(group, runningTaskId, i18n)).join("")}</div>`;
}

function groupTasks(tasks: WorkspaceTask[]): { title: string | undefined; tasks: WorkspaceTask[] }[] {
  const groups: { title: string | undefined; tasks: WorkspaceTask[] }[] = [];
  for (const task of tasks) {
    const title = task.group;
    let group = groups.find((candidate) => candidate.title === title);
    if (group === undefined) {
      group = { title, tasks: [] };
      groups.push(group);
    }
    group.tasks.push(task);
  }
  return groups;
}

function renderTaskGroup(group: { title: string | undefined; tasks: WorkspaceTask[] }, runningTaskId: string | undefined, i18n?: PluginI18n): string {
  const title = group.title === undefined ? "" : `<h3>${escapeHtml(group.title)}</h3>`;
  return `<section class="task-group">${title}${group.tasks.map((task) => renderTask(task, runningTaskId, i18n)).join("")}</section>`;
}

function renderTask(task: WorkspaceTask, runningTaskId: string | undefined, i18n?: PluginI18n): string {
  const running = runningTaskId === task.id;
  const disabled = runningTaskId !== undefined;
  const description = task.description === undefined ? "" : `<span>${escapeHtml(task.description)}</span>`;
  return `
    <article class="task-card">
      <div class="task-copy">
        <strong>${escapeHtml(task.title)}</strong>
        ${description}
        <code>${escapeHtml(task.command)}</code>
      </div>
      <button data-task-id="${escapeAttr(task.id)}" ${disabled ? "disabled" : ""}>${escapeHtml(running ? tr(i18n, "plugins.tasks.dispatching", "Dispatching…") : tr(i18n, "plugins.tasks.run", "Run"))}</button>
    </article>
  `;
}

function taskFromConfigState(state: ConfigState | undefined, taskId: string | null): WorkspaceTask | undefined {
  if (state?.kind !== "loaded" || taskId === null) return undefined;
  return state.config.tasks.find((task) => task.id === taskId);
}

function taskStyles(): string {
  return `
    <style>
      :host { display: contents; }
      .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--pi-border-muted); }
      .toolbar-tasks { display: inline-flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
      .viewer { box-sizing: border-box; min-height: 0; overflow: auto; padding: 12px; }
      .tasks-viewer { display: grid; align-content: start; gap: 12px; }
      .tasks { display: grid; gap: 14px; }
      .task-group { display: grid; gap: 10px; }
      .task-group h3 { margin: 4px 0 0; color: var(--pi-text-secondary); font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; }
      .task-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 12px; }
      .task-copy { display: grid; min-width: 0; gap: 5px; }
      .task-copy span, .muted { color: var(--pi-muted); }
      code, pre { border: 1px solid var(--pi-border-muted); border-radius: 6px; background: var(--pi-bg); color: var(--pi-text-secondary); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      code { overflow: auto; padding: 5px 7px; white-space: nowrap; }
      pre { margin: 8px 0 0; overflow: auto; padding: 8px; white-space: pre-wrap; }
      button { border: 1px solid var(--pi-accent-border); border-radius: 7px; background: var(--pi-accent); color: var(--pi-bg); cursor: pointer; padding: 6px 10px; font: inherit; }
      button.secondary { border-color: var(--pi-border); background: var(--pi-surface); color: var(--pi-text); }
      button:disabled { cursor: wait; opacity: 0.65; }
      .empty-state { border: 1px dashed var(--pi-border-muted); border-radius: 8px; color: var(--pi-muted); padding: 12px; }
      .empty-state p { margin: 6px 0 0; }
      .panel-status { margin: 12px 12px 0; }
      .status { border: 1px solid var(--pi-border); border-radius: 8px; padding: 10px; }
      .status.info { border-color: var(--pi-accent-border); background: var(--pi-bg-overlay-soft); }
      .status.success { border-color: var(--pi-success-border); background: var(--pi-success-surface); color: var(--pi-success); }
      .status.error { border-color: var(--pi-danger); color: var(--pi-danger); }
      .empty { padding: 16px; color: var(--pi-muted); }
      @media (max-width: 760px) {
        .task-card { grid-template-columns: 1fr; }
        .task-card button { justify-self: start; }
      }
    </style>
  `;
}

function escapeHtml(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value: unknown): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
