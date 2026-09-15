// @vitest-environment happy-dom

import { html, render, svg } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JsonValue, Workspace, WorkspaceBackend, WorkspacePanelContext, PluginI18n } from "@jmfederico/pi-web/plugin-api";
import { I18nManager } from "../../src/client/src/i18n/i18n";
import plugin from "./browser/pi-web-plugin.js";

const projectId = "project-1";
const workspaceId = "workspace-1";

const gitWorkspace: Workspace = {
  id: workspaceId,
  projectId,
  path: "/repo",
  label: "main",
  isMain: true,
  provider: { pluginId: "git", capabilities: { request: true, remove: false } },
};

function activate(sourcePluginId = "git", runtimePluginId = sourcePluginId) {
  const contributions = plugin.activate({
    apiVersion: 2,
    pluginId: sourcePluginId,
    runtimePluginId,
    html,
    svg,
  });
  return contributions.contributions;
}

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  window.history.replaceState({}, "", "/");
  document.body.replaceChildren();
});

function createPluginI18n(manager: I18nManager): PluginI18n {
  const translate: PluginI18n = Object.assign(
    (key: string, params?: Readonly<Record<string, string | number>>): string => manager.t(key, params),
    { locale: "" },
  );
  Object.defineProperty(translate, "locale", {
    get: () => manager.getLocale(),
    enumerable: true,
  });
  return translate;
}

describe("Git panel localization", () => {
  it("renders Chinese labels, updates on locale switch to English, and supports hostless fallback", async () => {
    const manager = new I18nManager("zh-CN");
    const i18n = createPluginI18n(manager);

    const backend = backendFixture({
      files: [
        { path: "src/main.ts", index: "unmodified", workingTree: "modified" },
        { path: "vendor/sub", index: "unmodified", workingTree: "modified", submoduleFromCommit: "1111111", submoduleToCommit: "2222222" },
      ],
      submodules: ["vendor/sub"],
      branch: null, // detached
    });

    const contributions = activate("git");
    const panel = contributions.workspacePanels?.[0];
    if (panel === undefined) throw new Error("Expected Git workspace panel");

    const context = panelContext(backend.request, gitWorkspace, i18n);
    const container = document.createElement("div");
    document.body.append(container);

    render(panel.render(context), container);
    await settleBackend();
    render(panel.render(context), container);

    // Verify Chinese elements
    expect(container.textContent).toContain("刷新");
    expect(container.textContent).toContain("列表");
    expect(container.textContent).toContain("树形");
    expect(container.textContent).toContain("子模块");
    expect(container.textContent).toContain("游离分支");
    expect(container.textContent).toContain("请选择已更改的文件。");
    expect(container.querySelector('[aria-label="更改文件视图"]')).not.toBeNull();

    // Select file to inspect diff viewer
    const mainBtn = [...container.querySelectorAll("button")].find((btn) => btn.textContent.includes("src/main.ts"));
    expect(mainBtn).toBeDefined();
    mainBtn?.click();
    await settleBackend();
    render(panel.render(context), container);

    expect(container.textContent).toContain("已暂存");
    expect(container.textContent).toContain("未暂存");
    expect(container.querySelector('[aria-label="统一差异"]')).not.toBeNull();

    // Switch to English
    manager.setLocale("en");
    render(panel.render(context), container);

    expect(container.textContent).toContain("Refresh");
    expect(container.textContent).toContain("List");
    expect(container.textContent).toContain("Tree");
    expect(container.textContent).toContain("submodule");
    expect(container.textContent).toContain("detached");
    expect(container.textContent).toContain("staged");
    expect(container.textContent).toContain("unstaged");
    expect(container.querySelector('[aria-label="Changed files view"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Unified diff"]')).not.toBeNull();

    // Hostless fallback (no i18n)
    const hostlessContext = panelContext(backend.request, gitWorkspace, undefined);
    render(panel.render(hostlessContext), container);
    expect(container.textContent).toContain("Refresh");
    expect(container.textContent).toContain("List");
    expect(container.textContent).toContain("Tree");
  });

  it("localizes empty states and non-repo messages", async () => {
    const manager = new I18nManager("zh-CN");
    const i18n = createPluginI18n(manager);

    const emptyBackend = backendFixture({ files: [], isGitRepo: true });
    const contributions = activate("git");
    const panel = contributions.workspacePanels?.[0];
    if (panel === undefined) throw new Error("Expected Git workspace panel");
    const context = panelContext(emptyBackend.request, gitWorkspace, i18n);

    const container = document.createElement("div");
    document.body.append(container);

    render(panel.render(context), container);
    await settleBackend();
    render(panel.render(context), container);

    expect(container.textContent).toContain("没有更改。");

    // Non-repo backend with a distinct workspace
    const nonRepoWorkspace: Workspace = {
      ...gitWorkspace,
      id: "workspace-non-repo",
    };
    const nonRepoBackend = backendFixture({ files: [], isGitRepo: false });
    const nonRepoContext = panelContext(nonRepoBackend.request, nonRepoWorkspace, i18n);
    render(panel.render(nonRepoContext), container);
    await settleBackend();
    render(panel.render(nonRepoContext), container);

    expect(container.textContent).toContain("不是 Git 仓库。");
  });
});

function backendFixture(initial: { files?: readonly Record<string, JsonValue>[]; submodules?: readonly string[]; isGitRepo?: boolean; branch?: string | null } = {}) {
  const hash = "status-hash-1";
  const status: Record<string, JsonValue> = {
    isGitRepo: initial.isGitRepo ?? true,
    ahead: 0,
    behind: 0,
    files: initial.files ?? [],
    submodules: initial.submodules ?? [],
    hash,
    ...(initial.branch === null ? {} : { branch: initial.branch ?? "main" }),
  };
  const request = vi.fn((operation: string, input: JsonValue): Promise<JsonValue> => {
    if (operation === "status") return Promise.resolve({
      ...status,
      hash: `${hash}:${JSON.stringify(status["files"])}`,
    });
    const staged = isRecord(input) && input["staged"] === true;
    const path = isRecord(input) && typeof input["path"] === "string" ? input["path"] : "diff";
    return Promise.resolve({
      path,
      staged,
      hash: staged ? "staged-hash" : "unstaged-hash",
      diff: staged ? "@@ -1 +1 @@\n-old value\n+new value" : "@@ -1 +1 @@\n-old work\n+new work",
      truncated: false,
    });
  });
  return { request, status };
}

function panelContext(request: WorkspaceBackend["request"] | undefined, workspace = gitWorkspace, i18n?: PluginI18n): WorkspacePanelContext {
  const noop = () => undefined;
  return {
    machine: { id: "local", name: "local", kind: "local" },
    workspace,
    state: { selectedWorkspace: workspace, workspaceTool: "git:workspace.git", mainView: "git:workspace.git" },
    ...(i18n !== undefined ? { i18n } : {}),
    files: {
      readFile: () => Promise.reject(new Error("not implemented")),
      listFiles: () => Promise.reject(new Error("not implemented")),
      writeFile: () => Promise.reject(new Error("not implemented")),
      deleteFile: () => Promise.reject(new Error("not implemented")),
      moveFile: () => Promise.reject(new Error("not implemented")),
    },
    ...(request === undefined ? {} : { backend: { request } }),
    host: { requestRender: noop },
    prompt: { insertText: noop, getText: () => "", getSelection: () => null },
    terminal: { open: noop, runCommand: () => Promise.reject(new Error("not implemented")) },
  };
}

async function settleBackend(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function isRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
