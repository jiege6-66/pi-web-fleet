// @vitest-environment happy-dom

import { html, render, svg } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import type { PiWebComponentStatus, PiWebStatusResponse, PluginI18n, PluginRuntimeState, TerminalCommandRun, WorkspacePanelContext, WorkspacePanelTerminal } from "@jmfederico/pi-web/plugin-api";
import { I18nManager } from "../../src/client/src/i18n/i18n";
import plugin from "./pi-web-plugin.js";

function component(overrides: Partial<PiWebComponentStatus> = {}): PiWebComponentStatus {
  return {
    component: "web",
    label: "Web/UI",
    runtimeVersion: "1.202605.8",
    installedVersion: "1.202605.8",
    stale: false,
    available: true,
    installation: { kind: "docker", dockerMode: "dev" },
    ...overrides,
  };
}

function status(overrides: Partial<PiWebStatusResponse> = {}): PiWebStatusResponse {
  return {
    packageName: "@jmfederico/pi-web",
    generatedAt: "2026-06-14T00:00:00.000Z",
    components: {
      web: component({ component: "web", label: "Web/UI" }),
      sessiond: component({ component: "sessiond", label: "Session daemon", stale: true }),
    },
    release: { packageName: "@jmfederico/pi-web", updateAvailable: true, latestVersion: "1.202605.9" },
    commands: {
      update: "pi-web-docker --dev update && pi-web-docker --dev restart",
      restart: "pi-web-docker --dev restart",
      restartWeb: "pi-web-docker --dev restart-web",
      restartSessiond: "pi-web-docker --dev restart-sessiond",
      status: "pi-web-docker --dev status",
    },
    messages: [],
    ...overrides,
  };
}

function panelContext(state: PluginRuntimeState, i18n?: PluginI18n, terminal?: WorkspacePanelTerminal): WorkspacePanelContext {
  const noop = () => undefined;
  return {
    machine: { id: "local", name: "local", kind: "local" },
    workspace: { id: "workspace-1", projectId: "project-1", path: "/repo", label: "main", isMain: true },
    state,
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
    terminal: terminal ?? { open: noop, runCommand: () => Promise.reject(new Error("not implemented")) },
  };
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

afterEach(() => {
  document.body.replaceChildren();
});

describe("Updates panel localization", () => {
  it("renders Chinese labels and commands, preserves command strings, switches to English, and supports hostless fallback", () => {
    const manager = new I18nManager("zh-CN");
    const i18n = createPluginI18n(manager);

    const dummyRun: TerminalCommandRun = {
      id: "run-1",
      origin: "test",
      projectId: "project-1",
      workspaceId: "workspace-1",
      terminalId: "term-1",
      title: "test",
      command: "echo test",
      status: "succeeded",
      createdAt: "2026-01-01T00:00:00.000Z",
      metadata: {},
    };

    const terminalMock: WorkspacePanelTerminal = {
      open: () => undefined,
      runCommand: () => Promise.resolve({ run: dummyRun, completed: Promise.resolve(dummyRun) }),
    };

    const contributions = plugin.activate({ apiVersion: 2, pluginId: "updates", runtimePluginId: "updates", html, svg }).contributions;
    const panel = contributions.workspacePanels?.[0];
    if (panel === undefined) throw new Error("Expected Updates workspace panel");

    const st = status();
    const context = panelContext({ piWebStatus: st }, i18n, terminalMock);
    const container = document.createElement("div");
    document.body.append(container);

    render(panel.render(context), container);

    // Verify Chinese elements
    expect(container.textContent).toContain("更新");
    expect(container.textContent).toContain("推荐操作");
    expect(container.textContent).toContain("更新并重启全部服务");
    expect(container.textContent).toContain("运行这一个命令即可使此安装完全保持最新。无需其他操作。");
    expect(container.textContent).toContain("已安装的服务");
    expect(container.textContent).toContain("最新");
    expect(container.textContent).toContain("需要重启");
    expect(container.textContent).toContain("运行中 1.202605.8 · 已安装 1.202605.8");
    expect(container.textContent).toContain("Docker 开发运行环境");
    expect(container.textContent).toContain("其他命令（可选）");
    expect(container.textContent).toContain("重启全部");
    expect(container.textContent).toContain("复制");
    expect(container.textContent).toContain("运行");
    expect(container.textContent).toContain("生成于 2026-06-14T00:00:00.000Z");
    expect(container.textContent).toContain("最新 npm 版本 1.202605.9");

    // Verify command strings remain completely untouched
    const commands = [...container.querySelectorAll(".updates-command code")].map((el) => el.textContent);
    expect(commands).toContain("pi-web-docker --dev update && pi-web-docker --dev restart");
    expect(commands).toContain("pi-web-docker --dev restart");

    // Dynamic switch to English
    manager.setLocale("en");
    render(panel.render(context), container);

    expect(container.textContent).toContain("Updates");
    expect(container.textContent).toContain("Recommended");
    expect(container.textContent).toContain("Update & restart everything");
    expect(container.textContent).toContain("Installed services");
    expect(container.textContent).toContain("current");
    expect(container.textContent).toContain("restart needed");
    expect(container.textContent).toContain("running 1.202605.8 · installed 1.202605.8");
    expect(container.textContent).toContain("Docker development runtime");
    expect(container.textContent).toContain("Additional commands (optional)");
    expect(container.textContent).toContain("Restart all");
    expect(container.textContent).toContain("Copy");
    expect(container.textContent).toContain("Run");

    // Hostless fallback
    const hostlessContext = panelContext({ piWebStatus: st }, undefined, terminalMock);
    render(panel.render(hostlessContext), container);
    expect(container.textContent).toContain("Recommended");
    expect(container.textContent).toContain("Installed services");
    expect(container.textContent).toContain("Update & restart everything");
  });
});
