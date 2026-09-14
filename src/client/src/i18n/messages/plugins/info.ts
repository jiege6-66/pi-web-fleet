import type { PluginLocaleFragment } from "./types";

/** Info plugin catalogs. Keys are `plugins.info.*`; literals live in the plugin as fallbacks. */
export const infoPluginMessages: PluginLocaleFragment = {
  en: {
    "plugins.info.panelTitle": "Info",
    "plugins.info.copyDiagnostics": "Copy PI WEB Diagnostics",
    "plugins.info.copyDiagnosticsDescription": "Copy version, installation, and status details for this machine, ready to paste into a bug report",
  },
  "zh-CN": {
    "plugins.info.panelTitle": "信息",
    "plugins.info.copyDiagnostics": "复制 PI WEB 诊断信息",
    "plugins.info.copyDiagnosticsDescription": "复制此机器的版本、安装与状态信息，可直接粘贴到问题报告中",
  },
};
