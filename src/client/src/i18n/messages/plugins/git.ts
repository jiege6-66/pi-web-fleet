import type { PluginLocaleFragment } from "./types";

/** Git plugin catalogs. Keys are `plugins.git.*`; literals live in the plugin as fallbacks. */
export const gitPluginMessages: PluginLocaleFragment = {
  en: {
    "plugins.git.panelTitle": "Git",
    "plugins.git.goTo": "Go to Git",
    "plugins.git.refresh": "Refresh Git",
  },
  "zh-CN": {
    "plugins.git.panelTitle": "Git",
    "plugins.git.goTo": "转到 Git",
    "plugins.git.refresh": "刷新 Git",
  },
};
