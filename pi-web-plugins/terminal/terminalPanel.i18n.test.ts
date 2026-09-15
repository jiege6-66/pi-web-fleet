// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginI18n, WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { I18nManager } from "../../src/client/src/i18n/i18n";
import { TerminalPanel } from "./TerminalPanel";
import { defineTerminalCustomElements, TERMINAL_PANEL_ELEMENT } from "./pi-web-plugin";
import { TerminalBrowserRuntime } from "./TerminalBrowserRuntime";
import { InMemoryTerminalSelectionMemory } from "./terminalSelection";

defineTerminalCustomElements();

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

function createTestContext(manager: I18nManager, withI18n = true): WorkspacePanelContext {
  const i18n = withI18n ? createPluginI18n(manager) : undefined;
  const noop = () => undefined;
  return {
    machine: { id: "local", name: "local", kind: "local" },
    workspace: { id: "ws1", projectId: "p1", path: "/test", label: "Test", isMain: true },
    ...(i18n !== undefined ? { i18n } : {}),
    files: {
      readFile: () => Promise.reject(new Error("not implemented")),
      listFiles: () => Promise.reject(new Error("not implemented")),
      writeFile: () => Promise.reject(new Error("not implemented")),
      deleteFile: () => Promise.reject(new Error("not implemented")),
      moveFile: () => Promise.reject(new Error("not implemented")),
    },
    host: { requestRender: noop },
    prompt: { insertText: noop, getText: () => "", getSelection: () => null },
    terminal: { open: noop, runCommand: () => Promise.reject(new Error("not implemented")) },
    navigation: {
      version: 1,
      contributionId: "pi-web.terminal:workspace.terminal",
      query: {},
      set: vi.fn(),
    },
    state: {},
  };
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("Terminal panel localization", () => {
  it("renders Chinese labels and updates when locale changes without recreating terminal", async () => {
    const manager = new I18nManager("zh-CN");
    const context = createTestContext(manager);
    const runtime = new TerminalBrowserRuntime(new InMemoryTerminalSelectionMemory());

    const panel = document.createElement(TERMINAL_PANEL_ELEMENT);
    expect(panel).toBeInstanceOf(TerminalPanel);
    if (!(panel instanceof TerminalPanel)) {
      throw new Error("Expected element to be an instance of TerminalPanel");
    }
    panel.context = context;
    panel.runtime = runtime;
    document.body.append(panel);
    await panel.updateComplete;

    // Simulate loading terminals
    Reflect.set(panel, "loading", true);
    await panel.updateComplete;
    expect(panel.shadowRoot?.textContent).toContain("正在加载终端…");

    // Add an active terminal
    Reflect.set(panel, "loading", false);
    Reflect.set(panel, "terminals", [
      { id: "term-1", name: "bash", cols: 80, rows: 24, exited: false },
    ]);
    Reflect.set(panel, "selectedId", "term-1");
    await panel.updateComplete;

    expect(panel.shadowRoot?.querySelector(".copy-mode-toggle")?.textContent).toContain("选择");
    expect(panel.shadowRoot?.querySelector(".soft-keys-toggle")?.textContent).toContain("按键");
    expect(panel.shadowRoot?.querySelector(".new")?.textContent).toContain("终端");

    // Switch to English
    manager.setLocale("en");
    panel.context = { ...context };
    await panel.updateComplete;

    expect(panel.shadowRoot?.querySelector(".copy-mode-toggle")?.textContent).toContain("Select");
    expect(panel.shadowRoot?.querySelector(".soft-keys-toggle")?.textContent).toContain("Keys");
    expect(panel.shadowRoot?.querySelector(".new")?.textContent).toContain("+ Shell");

    // Exit terminal in English
    Reflect.set(panel, "terminals", [
      { id: "term-1", name: "bash", cols: 80, rows: 24, exited: true, exitCode: 0 },
    ]);
    await panel.updateComplete;
    expect(panel.shadowRoot?.textContent).toContain(" · exited");

    // Switch to zh-CN while exited
    manager.setLocale("zh-CN");
    panel.context = { ...context };
    await panel.updateComplete;
    expect(panel.shadowRoot?.textContent).toContain(" · 已退出");

    // Switch back to hostless fallback
    panel.context = createTestContext(manager, false);
    await panel.updateComplete;

    expect(panel.shadowRoot?.textContent).toContain(" · exited");
    expect(panel.shadowRoot?.querySelector(".copy-mode-toggle")?.textContent).toContain("Select");
  });
});
