// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginI18n, WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { I18nManager } from "../../src/client/src/i18n/i18n";
import { defineTasksPanelElement, tasksPanelTagName } from "./tasksPanelElement";

defineTasksPanelElement();
let nextId = 0;
const task = { id: "build", title: '<img src=x onerror="alert(1)"> Build', command: 'printf "<keep>"', confirm: true };

interface TasksPanelTestElement extends HTMLElement {
  context: WorkspacePanelContext | undefined;
}

declare global {
  interface HTMLElementTagNameMap {
    "pi-web-workspace-tasks-panel": TasksPanelTestElement;
  }
}

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

function setup(content = JSON.stringify({ version: 1, tasks: [task] })) {
  const manager = new I18nManager("en");
  const i18n = createPluginI18n(manager);
  const readFile = vi.fn().mockResolvedValue({ content, truncated: false, binary: false });
  const runCommand = vi.fn().mockImplementation(() => new Promise(() => undefined));
  const noop = () => undefined;
  const context: WorkspacePanelContext = {
    machine: { id: "local", name: "local", kind: "local" },
    workspace: { id: String(++nextId), projectId: "project", path: "/repo", label: "main", isMain: true },
    i18n,
    files: {
      readFile,
      listFiles: () => Promise.reject(new Error("not implemented")),
      writeFile: () => Promise.reject(new Error("not implemented")),
      deleteFile: () => Promise.reject(new Error("not implemented")),
      moveFile: () => Promise.reject(new Error("not implemented")),
    },
    terminal: { runCommand, open: vi.fn() },
    host: { requestRender: vi.fn() },
    prompt: { insertText: noop, getText: () => "", getSelection: () => null },
  };
  const panel = document.createElement(tasksPanelTagName);
  panel.context = context;
  document.body.append(panel);
  const root = panel.shadowRoot;
  expect(root).toBeInstanceOf(ShadowRoot);
  if (!(root instanceof ShadowRoot)) {
    throw new Error("Expected shadowRoot to be rendered");
  }
  return { panel, root, context, manager, readFile, runCommand };
}
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks(); });
describe("Tasks locale switching", () => {
  it("rerenders a mutable host locale without reloading or resetting an in-flight task", async () => {
    const { panel, root, context, manager, readFile, runCommand } = setup();
    await vi.waitFor(() => {
      expect(root.querySelector("[data-task-id]")).not.toBeNull();
    });
    manager.setLocale("zh-CN");
    panel.context = context;
    expect(root.textContent).toContain("工作区任务");
    expect(root.querySelector("[data-task-id]")?.textContent).toBe("运行");
    expect(root.querySelector("img")).toBeNull();
    const confirmMock = vi.fn().mockReturnValue(true);
    window.confirm = confirmMock;
    const taskButton = root.querySelector("[data-task-id]");
    expect(taskButton).toBeInstanceOf(HTMLButtonElement);
    if (!(taskButton instanceof HTMLButtonElement)) {
      throw new Error("Expected button element");
    }
    taskButton.click();
    expect(confirmMock).toHaveBeenCalledWith(`运行 ${task.title}？\n\n${task.command}`);
    expect(runCommand).toHaveBeenCalledWith(expect.objectContaining({ title: task.title, command: task.command }));
    expect(root.textContent).toContain("正在启动");
    manager.setLocale("en");
    panel.context = context;
    expect(root.querySelector("[data-task-id]")?.textContent).toBe("Dispatching…");
    const runningButton = root.querySelector("[data-task-id]");
    expect(runningButton).toBeInstanceOf(HTMLButtonElement);
    if (!(runningButton instanceof HTMLButtonElement)) {
      throw new Error("Expected button element");
    }
    expect(runningButton.disabled).toBe(true);
    expect(root.textContent).toContain(`Starting ${task.title}…`);
    expect(readFile).toHaveBeenCalledOnce();
    expect(runCommand).toHaveBeenCalledOnce();
  });
  it("localizes empty tasks and keeps hostless English fallback", async () => {
    const { panel, root, context, manager } = setup(JSON.stringify({ version: 1, tasks: [] }));
    await vi.waitFor(() => {
      expect(root.textContent).toContain("No tasks are defined");
    });
    manager.setLocale("zh-CN"); panel.context = context;
    expect(root.textContent).toContain("尚未定义任务");
    delete context.i18n; panel.context = context;
    expect(root.textContent).toContain("No tasks are defined");
  });
  it("localizes error chrome without hiding original diagnostic text", async () => {
    const { panel, root, context, manager } = setup("not JSON");
    await vi.waitFor(() => {
      expect(root.querySelector("pre")).not.toBeNull();
    });
    const detail = root.querySelector("pre")?.textContent;
    manager.setLocale("zh-CN"); panel.context = context;
    expect(root.textContent).toContain("无法加载工作区任务");
    expect(root.querySelector("pre")?.textContent).toBe(detail);
  });
});
