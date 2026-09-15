// Implementation details of the bundled Info plugin.
//
// This file is NOT part of the plugin skeleton. If you copied the Info plugin
// as a starting point for your own plugin, replace everything here with your
// own content — the plugin contract (metadata and contribution definitions)
// lives in pi-web-plugin.ts.

import type { TemplateResult } from "lit";
import type { HtmlTemplateTag, MachineKind, PiWebComponentStatus, PiWebInstallationInfo, PiWebReleaseStatus, PiWebStatusResponse, PluginI18n, PluginMachine, PluginRuntimeContext, Workspace, WorkspacePanelContext } from "@jmfederico/pi-web/plugin-api";
import { tr } from "./i18n.js";

export type ComponentHealth = "current" | "restart needed" | "unavailable";

export function componentHealth(component: PiWebComponentStatus): ComponentHealth {
  if (!component.available) return "unavailable";
  if (component.stale) return "restart needed";
  return "current";
}

export function formatVersion(version: string | undefined, i18n?: PluginI18n): string {
  return version === undefined || version === "" ? tr(i18n, "plugins.info.unknown", "unknown") : version;
}

export function installationLabel(installation: PiWebInstallationInfo | undefined, i18n?: PluginI18n): string {
  if (installation?.kind === "pi-package") {
    const scope = installation.scope === undefined ? "" : ` · ${tr(i18n, `plugins.info.scope.${installation.scope}`, installation.scope)}`;
    return `${installation.source ?? "Pi package"}${scope}`;
  }
  if (installation?.kind === "npm-global") return tr(i18n, "plugins.info.npmGlobal", "global npm package");
  if (installation?.kind === "local") return tr(i18n, "plugins.info.localCheckout", "local checkout");
  if (installation?.kind === "docker") return installation.dockerMode === "dev"
    ? tr(i18n, "plugins.info.dockerDev", "Docker development runtime")
    : tr(i18n, "plugins.info.docker", "Docker runtime");
  return tr(i18n, "plugins.info.installationUnknown", "installation unknown");
}

export function machineKindLabel(kind: MachineKind, i18n?: PluginI18n): string {
  return kind === "local" ? tr(i18n, "plugins.info.localMachine", "local machine") : tr(i18n, "plugins.info.remoteMachine", "remote machine");
}

export function releaseSummary(release: PiWebReleaseStatus, i18n?: PluginI18n): string {
  if (release.updateAvailable) {
    return release.latestVersion === undefined || release.latestVersion === ""
      ? tr(i18n, "plugins.info.updateAvailable", "Update available")
      : tr(i18n, "plugins.info.updateVersion", "Update available: {version}", { version: release.latestVersion });
  }
  if (release.error !== undefined && release.error !== "") return tr(i18n, "plugins.info.updateFailed", "Update check failed: {error}", { error: release.error });
  if (release.skipped === true) return tr(i18n, "plugins.info.updateSkipped", "Update check skipped");
  return tr(i18n, "plugins.info.upToDate", "Up to date");
}

/** Omit i18n for the deliberately technical English clipboard diagnostics. */
export function componentDetails(component: PiWebComponentStatus, i18n?: PluginI18n): string {
  const parts = [
    tr(i18n, "plugins.info.runningVersion", "running {version}", { version: formatVersion(component.runtimeVersion, i18n) }),
    tr(i18n, "plugins.info.installedVersion", "installed {version}", { version: formatVersion(component.installedVersion, i18n) }),
    `pi ${formatVersion(component.piVersion, i18n)}`,
    tr(i18n, `plugins.info.health.${componentHealth(component)}`, componentHealth(component)),
    installationLabel(component.installation, i18n),
  ];
  if (component.installation?.path !== undefined && component.installation.path !== "") parts.push(component.installation.path);
  if (component.error !== undefined && component.error !== "") parts.push(tr(i18n, "plugins.info.error", "error: {error}", { error: component.error }));
  return parts.join(" · ");
}

/** Note shown when the session daemon runs a different Pi version than the web process. */
export function piVersionDriftNote(web: PiWebComponentStatus, sessiond: PiWebComponentStatus, i18n?: PluginI18n): string | undefined {
  if (!sessiond.available) return undefined;
  if (web.piVersion === undefined || sessiond.piVersion === undefined) return undefined;
  return web.piVersion === sessiond.piVersion ? undefined : tr(i18n, "plugins.info.daemonVersion", "session daemon running {version}", { version: formatVersion(sessiond.piVersion, i18n) });
}

export function workspaceFlags(workspace: Workspace, i18n?: PluginI18n): string[] {
  return [
    workspace.provider === undefined ? tr(i18n, "plugins.info.folderWorkspace", "folder workspace") : tr(i18n, "plugins.info.provider", "provider: {provider}", { provider: workspace.provider.pluginId }),
    workspace.isMain ? tr(i18n, "plugins.info.mainWorkspace", "main workspace") : undefined,
  ].filter((flag): flag is string => flag !== undefined);
}

export interface DiagnosticsInput {
  status: PiWebStatusResponse | undefined;
  machine?: PluginMachine | undefined;
  workspace?: Workspace | undefined;
}

/** Plain-text status block suitable for pasting into a bug report. */
export function diagnosticsSummary({ status, machine, workspace }: DiagnosticsInput): string {
  const lines: string[] = ["PI WEB diagnostics"];
  if (status === undefined) {
    lines.push("Status: unavailable");
  } else {
    lines.push(`Package: ${status.packageName}`);
    lines.push(`${status.components.web.label}: ${componentDetails(status.components.web)}`);
    lines.push(`${status.components.sessiond.label}: ${componentDetails(status.components.sessiond)}`);
    const checked = status.release.checkedAt === undefined || status.release.skipped === true ? "" : ` (checked ${status.release.checkedAt})`;
    lines.push(`Release: ${releaseSummary(status.release)}${checked}`);
    lines.push(`Status generated: ${status.generatedAt}`);
  }
  if (machine !== undefined) lines.push(`Machine: ${machine.name} (${machineKindLabel(machine.kind)})`);
  if (workspace === undefined) {
    lines.push("Workspace: none selected");
  } else {
    lines.push(`Workspace: ${workspace.label} — ${workspace.path} (${workspaceFlags(workspace).join(", ")})`);
  }
  return lines.join("\n");
}

/** Action body: copy the diagnostics summary for the current runtime context. */
export async function copyDiagnostics(context: PluginRuntimeContext): Promise<void> {
  const summary = diagnosticsSummary({
    status: context.state.piWebStatus,
    machine: context.state.selectedMachine,
    workspace: context.state.selectedWorkspace,
  });
  await navigator.clipboard.writeText(summary);
}

function renderComponent(html: HtmlTemplateTag, component: PiWebComponentStatus, i18n?: PluginI18n): TemplateResult {
  const health = componentHealth(component);
  return html`
    <div class="info-component">
      <strong>${tr(i18n, `plugins.info.component.${component.component}`, component.label)}</strong>
      <span class=${health === "current" ? "info-health-ok" : "info-health-attention"}>${tr(i18n, `plugins.info.health.${health}`, health)}</span>
      <small>${componentDetails(component, i18n)}</small>
    </div>
  `;
}

function renderStatusSection(html: HtmlTemplateTag, status: PiWebStatusResponse | undefined, i18n?: PluginI18n): TemplateResult {
  if (status === undefined) {
    return html`<section><strong>PI WEB</strong><p class="muted">${tr(i18n, "plugins.info.statusUnavailable", "PI WEB status is not available yet. It refreshes automatically in the background.")}</p></section>`;
  }
  const web = status.components.web;
  const driftNote = piVersionDriftNote(web, status.components.sessiond, i18n);
  const messageCount = status.messages.length;
  return html`
    <section>
      <strong>PI WEB</strong>
      <div class="info-row">
        <span>${tr(i18n, "plugins.info.version", "Version")}</span>
        <span>${formatVersion(web.runtimeVersion, i18n)}</span>
        ${web.installedVersion === undefined || web.installedVersion === web.runtimeVersion ? null : html`<small>${tr(i18n, "plugins.info.installedVersion", "installed {version}", { version: formatVersion(web.installedVersion, i18n) })}</small>`}
      </div>
      <div class="info-row">
        <span>Pi</span><span>${formatVersion(web.piVersion, i18n)}</span>
        ${driftNote === undefined ? null : html`<small>${driftNote}</small>`}
      </div>
      <div class="info-row">
        <span>${tr(i18n, "plugins.info.package", "Package")}</span><span>${status.packageName}</span>
      </div>
      <div class="info-row">
        <span>${tr(i18n, "plugins.info.installation", "Installation")}</span>
        <span>${installationLabel(web.installation, i18n)}</span>
        ${web.installation?.path === undefined || web.installation.path === "" ? null : html`<small>${web.installation.path}</small>`}
      </div>
      <div class="info-row">
        <span>${tr(i18n, "plugins.info.release", "Release")}</span>
        <span>${releaseSummary(status.release, i18n)}</span>
        ${status.release.checkedAt === undefined || status.release.skipped === true ? null : html`<small>${tr(i18n, "plugins.info.checked", "checked {time}", { time: status.release.checkedAt })}</small>`}
      </div>
      ${messageCount === 0 ? null : html`<p class="muted">${tr(i18n, messageCount === 1 ? "plugins.info.statusMessage" : "plugins.info.statusMessages", messageCount === 1 ? "{count} status message — open the Updates tab for details." : "{count} status messages — open the Updates tab for details.", { count: messageCount })}</p>`}
      <p class="muted">${tr(i18n, "plugins.info.generated", "Status generated {time}", { time: status.generatedAt })}</p>
    </section>
    <section>
      <strong>${tr(i18n, "plugins.info.services", "Services")}</strong>
      ${renderComponent(html, status.components.web, i18n)}
      ${renderComponent(html, status.components.sessiond, i18n)}
    </section>
  `;
}

function renderMachineSection(html: HtmlTemplateTag, machine: PluginMachine, i18n?: PluginI18n): TemplateResult {
  return html`
    <section>
      <strong>${tr(i18n, "plugins.info.machine", "Machine")}</strong>
      <div class="info-row"><span>${tr(i18n, "plugins.info.name", "Name")}</span><span>${machine.name}</span></div>
      <div class="info-row"><span>${tr(i18n, "plugins.info.type", "Type")}</span><span>${machineKindLabel(machine.kind, i18n)}</span></div>
    </section>
  `;
}

function renderWorkspaceSection(html: HtmlTemplateTag, workspace: Workspace, i18n?: PluginI18n): TemplateResult {
  return html`
    <section>
      <strong>${tr(i18n, "plugins.info.workspace", "Workspace")}</strong>
      <div class="info-row"><span>${tr(i18n, "plugins.info.name", "Name")}</span><span>${workspace.label}</span></div>
      <div class="info-row">
        <span>${tr(i18n, "plugins.info.path", "Path")}</span>
        <span class="info-path">${workspace.path}</span>
        <small>${workspaceFlags(workspace, i18n).join(" · ")}</small>
      </div>
    </section>
  `;
}

/** Panel body: render the Info tab for the current workspace panel context. */
export function renderInfoPanel(html: HtmlTemplateTag, context: WorkspacePanelContext): TemplateResult {
  return html`
    <style>
      .viewer.info-status { flex: 1 1 auto; min-height: 0; box-sizing: border-box; display: flex; flex-direction: column; gap: 14px; padding: 12px; overflow-y: auto; overflow-x: hidden; }
      .viewer.info-status section { flex: 0 0 auto; min-width: 0; display: grid; gap: 8px; align-content: start; }
      .viewer.info-status p { margin: 0; }
      .info-row { display: grid; grid-template-columns: minmax(90px, auto) minmax(0, 1fr); gap: 3px 10px; border-bottom: 1px solid var(--pi-border-muted); padding: 6px 0; overflow-wrap: anywhere; }
      .info-row small { grid-column: 1 / -1; color: var(--pi-muted); }
      .info-component { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 10px; border-bottom: 1px solid var(--pi-border-muted); padding: 6px 0; }
      .info-component small { grid-column: 1 / -1; color: var(--pi-muted); overflow-wrap: anywhere; }
      .info-health-ok { color: var(--pi-success); }
      .info-health-attention { color: var(--pi-warning); }
    </style>
    <section class="toolbar"><strong>${tr(context.i18n, "plugins.info.panelTitle", "Info")}</strong></section>
    <section class="viewer info-status">
      ${renderStatusSection(html, context.state?.piWebStatus, context.i18n)}
      ${renderMachineSection(html, context.machine, context.i18n)}
      ${renderWorkspaceSection(html, context.workspace, context.i18n)}
    </section>
  `;
}
