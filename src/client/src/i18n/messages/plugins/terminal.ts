import type { PluginLocaleFragment } from "./types";

/** Terminal plugin catalogs. Keys are `plugins.terminal.*`; literals live in the plugin as fallbacks. */
export const terminalPluginMessages: PluginLocaleFragment = {
  en: {
    "plugins.terminal.panelTitle": "Terminal",
    "plugins.terminal.goTo": "Go to Terminal",
  },
  "zh-CN": {
    "plugins.terminal.panelTitle": "终端",
    "plugins.terminal.goTo": "转到终端",
  },
};
