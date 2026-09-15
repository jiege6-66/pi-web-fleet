// @vitest-environment happy-dom
import { html, render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginI18n, WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { I18nManager } from "../../src/client/src/i18n/i18n";
import { diagnosticsSummary, renderInfoPanel } from "./infoInternals";

function createPluginI18n(mgr: I18nManager): PluginI18n {
  const translate: PluginI18n = Object.assign(
    (key: string, params?: Readonly<Record<string, string | number>>): string => mgr.t(key, params),
    { locale: "" },
  );
  Object.defineProperty(translate, "locale", {
    get: () => mgr.getLocale(),
    enumerable: true,
  });
  return translate;
}

const manager = new I18nManager("zh-CN");
const i18n: PluginI18n = createPluginI18n(manager);

function context(options?: { withoutState?: boolean; withoutI18n?: boolean }): WorkspacePanelContext {
  const noop = () => undefined;
  const ctx: WorkspacePanelContext = {
    machine: { id: "local", name: "my devbox", kind: "local" },
    workspace: { id: "ws", projectId: "project", path: '/tmp/<script> & "repo"', label: "My project", isMain: true },
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
  };
  if (options?.withoutState !== true) {
    ctx.state = {
      piWebStatus: {
        packageName: "@jmfederico/pi-web",
        generatedAt: "2026-01-01T00:00:00Z",
        components: {
          web: { component: "web", label: "Web/UI", available: true, stale: false, runtimeVersion: "1.0", installation: { kind: "docker", dockerMode: "dev" } },
          sessiond: { component: "sessiond", label: "Session daemon", available: false, stale: false, error: "ECONNREFUSED original diagnostic" },
        },
        release: { packageName: "@jmfederico/pi-web", updateAvailable: false },
        commands: {},
        messages: [],
      },
    };
  }
  if (options?.withoutI18n !== true) {
    ctx.i18n = i18n;
  }
  return ctx;
}
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); manager.setLocale("zh-CN"); });
describe("Info panel localization", () => {
  it("renders Chinese labels, preserves diagnostics and user paths, and switches to English", () => {
    const ctx = context();
    const host = document.createElement("div");
    document.body.append(host);
    render(renderInfoPanel(html, ctx), host);
    for (const label of ["信息", "版本", "安装方式", "服务", "本地机器", "主工作区", "不可用", "Docker 开发运行环境"]) {
      expect(document.body.textContent).toContain(label);
    }
    expect(document.body.textContent).toContain(ctx.workspace.path);
    expect(document.body.querySelector("script")).toBeNull();
    expect(document.body.textContent).toContain("ECONNREFUSED original diagnostic");
    expect(diagnosticsSummary({ status: ctx.state?.piWebStatus })).toContain("PI WEB diagnostics");
    manager.setLocale("en");
    render(renderInfoPanel(html, ctx), host);
    expect(document.body.textContent).toContain("Services");
    expect(document.body.textContent).toContain("local machine");
  });
  it("localizes unavailable status and keeps hostless English fallback", () => {
    const ctx = context({ withoutState: true });
    const host = document.createElement("div");
    document.body.append(host);
    render(renderInfoPanel(html, ctx), host);
    expect(document.body.textContent).toContain("PI WEB 状态暂不可用");
    const hostlessCtx = context({ withoutState: true, withoutI18n: true });
    render(renderInfoPanel(html, hostlessCtx), host);
    expect(document.body.textContent).toContain("PI WEB status is not available yet");
  });
});
