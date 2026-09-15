// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileContentResponse, FileTreeEntry, FileTreeResponse, PluginI18n, WorkspaceFiles, WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { I18nManager } from "../../src/client/src/i18n/i18n";
import { RELAYS_ROOT } from "./relayDiscovery";
import { defineRelaysPanelElement, relaysPanelTagName } from "./relaysPanelElement";

interface RelaysPanelTestElement extends HTMLElement {
  context: WorkspacePanelContext | undefined;
}

declare global {
  interface HTMLElementTagNameMap {
    "pi-web-relays-panel": RelaysPanelTestElement;
  }
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
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

describe("Relays panel localization", () => {
  it("renders Chinese labels, updates dynamically on locale switch for the same workspace, and supports hostless fallback", async () => {
    const manager = new I18nManager("zh-CN");
    const i18n = createPluginI18n(manager);

    const fake = workspaceFilesFake();
    fake.addDirectory(RELAYS_ROOT, [relayDirectory("test-relay", "2026-02-01T00:00:00.000Z")]);
    fake.addDirectory(`${RELAYS_ROOT}/test-relay`, [
      relayDocument("test-relay", "status.md"),
      relayDocument("test-relay", "image.png"),
    ]);
    fake.addDocument(`${RELAYS_ROOT}/test-relay/status.md`, "# Status\nAll good.", { truncated: true });
    fake.addDocument(`${RELAYS_ROOT}/test-relay/image.png`, "", { binary: true });

    const context = panelContext(fake, "ws-1", i18n);
    defineRelaysPanelElement();
    const panel = document.createElement(relaysPanelTagName);
    document.body.append(panel);
    panel.context = context;
    await flushAsync();

    const root = panel.shadowRoot;
    expect(root).toBeInstanceOf(ShadowRoot);
    if (!(root instanceof ShadowRoot)) {
      throw new Error("Expected shadowRoot to be rendered");
    }

    // Toolbar Chinese
    expect(root.querySelector(".toolbar strong")?.textContent).toContain("接力");
    const refreshBtn = root.querySelector("button[data-refresh]");
    expect(refreshBtn?.getAttribute("aria-label")).toBe("刷新");
    expect(refreshBtn?.getAttribute("title")).toBe("刷新");

    // Truncated notice Chinese
    expect(root.querySelector(".viewer")?.textContent).toContain("此文档已截断 — 仅显示开头部分。");

    // Switch to binary doc
    const buttons = root.querySelectorAll("button[data-document-path]");
    let imgTab: HTMLButtonElement | undefined;
    for (const button of buttons) {
      if (button instanceof HTMLButtonElement && button.textContent.includes("image.png")) {
        imgTab = button;
        break;
      }
    }
    expect(imgTab).toBeDefined();
    if (imgTab === undefined) {
      throw new Error("Expected image.png tab to be present");
    }
    imgTab.click();
    await flushAsync();

    expect(root.querySelector(".viewer")?.textContent).toContain("二进制文件：image.png");
    expect(root.querySelector(".viewer")?.textContent).toContain("二进制文档无法提供文本预览。");

    // Dynamic switch to English on the SAME workspace
    manager.setLocale("en");
    // Trigger context setter with updated i18n
    panel.context = context;
    await flushAsync();

    expect(root.querySelector(".toolbar strong")?.textContent).toContain("Relays");
    expect(root.querySelector("button[data-refresh]")?.getAttribute("aria-label")).toBe("Refresh");
    expect(root.querySelector(".viewer")?.textContent).toContain("Binary file: image.png");
    expect(root.querySelector(".viewer")?.textContent).toContain("Binary documents have no text preview.");

    // Hostless fallback (no i18n)
    const hostlessContext = panelContext(fake, "ws-2", undefined);
    panel.context = hostlessContext;
    await flushAsync();
    expect(root.querySelector(".toolbar strong")?.textContent).toContain("Relays");
    expect(root.querySelector("button[data-refresh]")?.getAttribute("aria-label")).toBe("Refresh");
  });

  it("localizes empty states and missing relay messages", async () => {
    const manager = new I18nManager("zh-CN");
    const i18n = createPluginI18n(manager);

    const fake = workspaceFilesFake();
    // No relays
    const context = panelContext(fake, "ws-empty", i18n);
    defineRelaysPanelElement();
    const panel = document.createElement(relaysPanelTagName);
    document.body.append(panel);
    panel.context = context;
    await flushAsync();

    const root = panel.shadowRoot;
    expect(root).toBeInstanceOf(ShadowRoot);
    if (!(root instanceof ShadowRoot)) {
      throw new Error("Expected shadowRoot to be rendered");
    }
    expect(root.querySelector(".viewer")?.textContent).toContain("此工作区中没有接力。");
  });
});

interface WorkspaceFilesFake {
  files: WorkspaceFiles;
  addDirectory(path: string, entries: FileTreeEntry[]): void;
  addDocument(path: string, content: string, overrides?: Partial<FileContentResponse>): void;
  failWith(path: string, error: Error): void;
}

function workspaceFilesFake(): WorkspaceFilesFake {
  const trees = new Map<string, FileTreeEntry[]>();
  const documents = new Map<string, FileContentResponse>();
  const failures = new Map<string, Error>();

  const checkFailure = (path: string): void => {
    const error = failures.get(path);
    if (error !== undefined) throw error;
  };

  return {
    files: {
      listFiles: (path?: string): Promise<FileTreeResponse> => {
        const lookup = path ?? "";
        checkFailure(lookup);
        const entries = trees.get(lookup);
        if (entries === undefined) return Promise.reject(new Error("Path does not exist"));
        return Promise.resolve({ path: lookup, entries, scannedAt: "2026-02-01T00:00:00.000Z", truncated: false });
      },
      readFile: (path: string): Promise<FileContentResponse> => {
        checkFailure(path);
        const doc = documents.get(path);
        if (doc === undefined) return Promise.reject(new Error("Path does not exist"));
        return Promise.resolve(doc);
      },
      writeFile: () => Promise.reject(new Error("not implemented")),
      deleteFile: () => Promise.reject(new Error("not implemented")),
      moveFile: () => Promise.reject(new Error("not implemented")),
    },
    addDirectory: (path, entries) => {
      trees.set(path, entries);
    },
    addDocument: (path, content, overrides = {}) => {
      documents.set(path, {
        path,
        encoding: "utf8",
        size: content.length,
        modifiedAt: "2026-01-01T00:00:00.000Z",
        content,
        truncated: false,
        binary: false,
        ...overrides,
      });
    },
    failWith: (path, error) => {
      failures.set(path, error);
    },
  };
}

function panelContext(fake: WorkspaceFilesFake, workspaceId = "ws-1", i18n?: PluginI18n): WorkspacePanelContext {
  return {
    machine: { id: "machine-1", name: "Local", kind: "local" },
    workspace: { id: workspaceId, projectId: "project-1", path: "/repo", label: "repo", isMain: true },
    files: fake.files,
    ...(i18n !== undefined ? { i18n } : {}),
    host: { requestRender: () => undefined },
    prompt: { insertText: () => undefined, getText: () => "", getSelection: () => null },
    terminal: { open: () => undefined, runCommand: () => Promise.reject(new Error("terminal not used")) },
  };
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function relayDirectory(name: string, modifiedAt?: string): FileTreeEntry {
  return { name, path: `${RELAYS_ROOT}/${name}`, type: "directory", ...(modifiedAt === undefined ? {} : { modifiedAt }) };
}

function relayDocument(relayName: string, name: string, modifiedAt?: string): FileTreeEntry {
  return { name, path: `${RELAYS_ROOT}/${relayName}/${name}`, type: "file", ...(modifiedAt === undefined ? {} : { modifiedAt }) };
}
