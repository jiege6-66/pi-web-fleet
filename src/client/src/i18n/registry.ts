import { enLocale } from "./messages/en";
import { zhCNLocale } from "./messages/zh-CN";
import { pluginLocaleFragments } from "./messages/plugins";
import type { Locale, LocalePlugin } from "./types";

/**
 * Host catalogs with every bundled plugin's fragment merged in.
 *
 * Plugin fragments live next to their plugin (`messages/plugins/<plugin>.ts`)
 * so a plugin's copy can be added or updated without touching the host
 * catalogs. Fragments only ever add `plugins.*` keys.
 */
function mergedMessages(locale: Locale, base: Readonly<Record<string, string>>): Record<string, string> {
  const merged: Record<string, string> = { ...base };
  for (const fragment of pluginLocaleFragments) {
    for (const [key, value] of Object.entries(fragment[locale])) {
      if (key in merged) console.warn(`Duplicate i18n key ${key} in plugin fragment for ${locale}`);
      merged[key] = value;
    }
  }
  return merged;
}

export const localePlugins: LocalePlugin[] = [
  { ...enLocale, messages: mergedMessages("en", enLocale.messages) },
  { ...zhCNLocale, messages: mergedMessages("zh-CN", zhCNLocale.messages) },
];

export function getLocalePlugin(id: string): LocalePlugin | undefined {
  return localePlugins.find((plugin) => plugin.id === id);
}

export function getSupportedLocales(): Locale[] {
  return localePlugins.map((plugin) => plugin.id);
}

export function resolveBrowserLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const normalized = language.toLowerCase();
    if (normalized === "en" || normalized.startsWith("en-")) return "en";
    if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  }
  return "en";
}
