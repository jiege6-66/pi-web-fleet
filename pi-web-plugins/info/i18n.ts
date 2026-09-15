import type { PluginI18n } from "@jmfederico/pi-web/plugin-api";

/** Keep the plugin usable on older hosts without a translation handle/catalog. */
export function tr(i18n: PluginI18n | undefined, key: string, fallback: string, params?: Readonly<Record<string, string | number>>): string {
  const translated = i18n?.(key, params);
  if (translated !== undefined && translated !== "" && translated !== key) return translated;
  return fallback.replace(/\{([\w.-]+)\}/g, (token, name: string) => params?.[name] === undefined ? token : String(params[name]));
}
