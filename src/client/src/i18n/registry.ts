import { enLocale } from "./messages/en";
import { zhCNLocale } from "./messages/zh-CN";
import type { Locale, LocalePlugin } from "./types";

export const localePlugins: LocalePlugin[] = [enLocale, zhCNLocale];

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
