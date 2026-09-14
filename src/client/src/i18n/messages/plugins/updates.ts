import type { PluginLocaleFragment } from "./types";

/** Updates plugin catalogs. Keys are `plugins.updates.*`; literals live in the plugin as fallbacks. */
export const updatesPluginMessages: PluginLocaleFragment = {
  en: {
    "plugins.updates.panelTitle": "Updates",
    "plugins.updates.check": "Check for PI WEB Updates",
    "plugins.updates.checkDescription": "Bypass cached release data and check the selected machine now",
  },
  "zh-CN": {
    "plugins.updates.panelTitle": "更新",
    "plugins.updates.check": "检查 PI WEB 更新",
    "plugins.updates.checkDescription": "跳过缓存的版本数据，立即检查所选机器",
  },
};
