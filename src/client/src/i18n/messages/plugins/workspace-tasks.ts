import type { PluginLocaleFragment } from "./types";

/** Workspace Tasks plugin catalogs. Keys are `plugins.tasks.*`; literals live in the plugin as fallbacks. */
export const tasksPluginMessages: PluginLocaleFragment = {
  en: {
    "plugins.tasks.panelTitle": "Tasks",
    "plugins.tasks.open": "Open Workspace Tasks",
  },
  "zh-CN": {
    "plugins.tasks.panelTitle": "任务",
    "plugins.tasks.open": "打开工作区任务",
  },
};
