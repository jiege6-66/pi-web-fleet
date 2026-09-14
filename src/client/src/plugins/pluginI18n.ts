import { i18n } from "../i18n";
import type { PluginI18n } from "./types";

/**
 * The host translation handle handed to plugins.
 *
 * Bundled plugins are separate packages built on their own (see
 * `scripts/build-plugins.mjs`), so they cannot import the client i18n module
 * directly. They receive this handle through the plugin API instead:
 * contribution metadata uses `titleKey`/`descriptionKey`/`groupKey` resolved
 * by the host at render time, and runtime copy calls the handle during render
 * so a language switch re-translates on the next update.
 *
 * `locale` is a live getter: the handle can be created once and still report
 * the active locale after a switch.
 */
export const pluginI18n: PluginI18n = Object.freeze(
  Object.defineProperty(
    (key: string, params?: Readonly<Record<string, string | number>>): string => i18n.t(key, params),
    "locale",
    { get: () => i18n.getLocale(), enumerable: true, configurable: false },
  ) as PluginI18n,
);

/**
 * Resolve a contribution's display text at consumption time.
 *
 * Contributions may carry an optional translation key next to the literal
 * fallback (`titleKey` + `title`). The key wins when the plugin supplies one;
 * otherwise the literal is used, which keeps older plugins and untranslated
 * namespaces rendering exactly as before. Resolution is deferred to render so
 * a language switch immediately re-translates every label.
 */
export function resolvePluginKey(key: string | undefined, fallback: string): string {
  if (key === undefined || key === "") return fallback;
  const translated = i18n.t(key);
  // translateMessage returns the key itself when no catalog entry exists;
  // treat that (and an empty result) as "no translation" so the literal
  // fallback the plugin shipped still renders.
  return translated === "" || translated === key ? fallback : translated;
}
