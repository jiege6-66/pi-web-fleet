import type { Locale } from "../../types";

/**
 * Locale fragment contributed by a bundled plugin's translation file.
 *
 * Bundled plugins are separate packages (see `scripts/build-plugins.mjs`), so
 * each one owns its own catalog fragment under this directory instead of
 * appending to `../en.ts` / `../zh-CN.ts`. `../plugins/index.ts` merges every
 * fragment into the host catalogs at startup; a fragment needs a complete key
 * set for every supported locale (a missing key falls back to English, then
 * to the literal the plugin ships).
 */
export type PluginLocaleFragment = Record<Locale, Readonly<Record<string, string>>>;
