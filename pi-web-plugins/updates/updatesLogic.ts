import type { PiWebDockerMode, PiWebInstallationInfo, PiWebStatusMessage, PiWebStatusResponse, PluginI18n, PluginRuntimeState } from "@jmfederico/pi-web/plugin-api";
import { tr } from "./i18n.js";

export interface CommandEntry {
  label: string;
  command: string;
}

export interface UpdatesRuntimeHint {
  dockerMode?: PiWebDockerMode;
}

// The single command users should run when they do not want to think: if an
// update is available, `commands.update` already chains the update and a full
// restart; otherwise, when anything is stale, a full restart is enough.
export function recommendedCommand(status: PiWebStatusResponse, i18n?: PluginI18n): CommandEntry | undefined {
  const { commands, release, components } = status;
  if (release.updateAvailable && typeof commands.update === "string" && commands.update !== "") {
    return { label: tr(i18n, "plugins.updates.command.updateAndRestart", "Update & restart everything"), command: commands.update };
  }
  const restartNeeded = components.web.stale || components.sessiond.stale || !components.sessiond.available;
  if (restartNeeded && typeof commands.restart === "string" && commands.restart !== "") {
    return { label: tr(i18n, "plugins.updates.command.restartEverything", "Restart everything"), command: commands.restart };
  }
  return undefined;
}

export function additionalCommands(status: PiWebStatusResponse, recommended: CommandEntry | undefined, i18n?: PluginI18n): CommandEntry[] {
  const candidates: [string, string, string | undefined][] = [
    ["plugins.updates.command.update", "Update", status.commands.update],
    ["plugins.updates.command.restartAll", "Restart all", status.commands.restart],
    ["plugins.updates.command.restartWeb", "Restart Web/UI", status.commands.restartWeb],
    ["plugins.updates.command.restartSessiond", "Restart session daemon", status.commands.restartSessiond],
    ["plugins.updates.command.status", "Status", status.commands.status],
  ];
  return candidates
    .filter((entry): entry is [string, string, string] => typeof entry[2] === "string" && entry[2] !== "")
    .filter(([, , command]) => command !== recommended?.command)
    .map(([key, fallback, command]) => ({ label: tr(i18n, key, fallback), command }));
}

export function messagesFor(state: PluginRuntimeState | undefined): PiWebStatusMessage[] {
  return state?.piWebStatus?.messages ?? [];
}

export function statusFor(state: PluginRuntimeState | undefined): PiWebStatusResponse | undefined {
  return state?.piWebStatus;
}

export function messageCount(state: PluginRuntimeState | undefined): number {
  return messagesFor(state).length;
}

export function isSelfManagedInstallation(installation: PiWebInstallationInfo | undefined): boolean {
  return installation === undefined || installation.kind === "local" || installation.kind === "docker" || installation.kind === "unknown";
}

export function shouldShowUpdatesPanel(state: PluginRuntimeState | undefined, hint: UpdatesRuntimeHint = {}): boolean {
  const status = statusFor(state);
  if (hint.dockerMode !== undefined) return true;
  if (messageCount(state) > 0) return true;
  if (status === undefined) return false;
  return isSelfManagedInstallation(status.components.web.installation)
    || isSelfManagedInstallation(status.components.sessiond.installation);
}

export function fallbackDockerStatus(hint: UpdatesRuntimeHint, generatedAt = "federated status unavailable", i18n?: PluginI18n): PiWebStatusResponse | undefined {
  if (hint.dockerMode === undefined) return undefined;
  const commandPrefix = hint.dockerMode === "dev" ? "pi-web-docker --dev" : "pi-web-docker";
  const installation: PiWebInstallationInfo = { kind: "docker", dockerMode: hint.dockerMode };
  return {
    packageName: "@jmfederico/pi-web",
    generatedAt,
    components: {
      web: { component: "web", label: "Web/UI", stale: false, available: true, installation },
      sessiond: { component: "sessiond", label: "Session daemon", stale: false, available: true, installation },
    },
    release: { packageName: "@jmfederico/pi-web", updateAvailable: false, skipped: true },
    commands: {
      update: `${commandPrefix} update`,
      restart: `${commandPrefix} restart`,
      restartWeb: `${commandPrefix} restart-web`,
      restartSessiond: `${commandPrefix} restart-sessiond`,
      status: `${commandPrefix} status`,
    },
    messages: [{
      id: "docker-status-compatibility",
      severity: "info",
      title: tr(i18n, "plugins.updates.dockerNoticeTitle", "Docker update commands available"),
      body: tr(i18n, "plugins.updates.dockerNoticeBody", "This Updates plugin was loaded from a Docker PI WEB runtime, but the gateway has not provided Docker-aware status details yet. The Docker maintenance commands below are still available."),
    }],
  };
}

export function formatVersion(version: string | undefined, i18n?: PluginI18n): string {
  return version === undefined || version === "" ? tr(i18n, "plugins.updates.unknown", "unknown") : version;
}

export function installationLabel(installation: PiWebInstallationInfo | undefined, i18n?: PluginI18n): string {
  if (installation === undefined) return tr(i18n, "plugins.updates.installationUnknown", "installation unknown");
  if (installation.kind === "pi-package") {
    const scope = installation.scope === undefined ? "" : ` · ${installation.scope}`;
    const source = installation.source ?? tr(i18n, "plugins.updates.piPackage", "Pi package");
    return `${source}${scope}`;
  }
  if (installation.kind === "npm-global") return tr(i18n, "plugins.updates.npmGlobal", "global npm package");
  if (installation.kind === "local") return tr(i18n, "plugins.updates.localCheckout", "local checkout");
  if (installation.kind === "docker") return installation.dockerMode === "dev"
    ? tr(i18n, "plugins.updates.dockerDev", "Docker development runtime")
    : tr(i18n, "plugins.updates.docker", "Docker runtime");
  return tr(i18n, "plugins.updates.installationUnknown", "installation unknown");
}
