import { commonPluginMessages } from "./common";
import { filesPluginMessages } from "./files";
import { gitPluginMessages } from "./git";
import { infoPluginMessages } from "./info";
import { relaysPluginMessages } from "./relays";
import { terminalPluginMessages } from "./terminal";
import { updatesPluginMessages } from "./updates";
import { tasksPluginMessages } from "./workspace-tasks";
import type { PluginLocaleFragment } from "./types";

export type { PluginLocaleFragment } from "./types";

/**
 * Every bundled plugin's locale fragment, merged into the host catalogs.
 *
 * Order is cosmetic (later fragments win on key collisions, and keys are
 * namespaced per plugin so collisions are bugs). Adding a plugin means adding
 * its fragment file here.
 */
export const pluginLocaleFragments: readonly PluginLocaleFragment[] = [
  commonPluginMessages,
  filesPluginMessages,
  gitPluginMessages,
  infoPluginMessages,
  terminalPluginMessages,
  updatesPluginMessages,
  tasksPluginMessages,
  relaysPluginMessages,
];
