import type { Locale, TranslationParams } from "./types";

export type MessagesByLocale = Record<string, Record<string, string>>;

export function interpolateMessage(message: string, params?: TranslationParams): string {
  if (!params) return message;
  return message.replace(/\{([\w.-]+)\}/g, (token, name: string) => {
    const value = params[name];
    return value === undefined ? token : String(value);
  });
}

export function translateMessage(
  locale: Locale,
  key: string,
  messages: MessagesByLocale,
  params?: TranslationParams,
): string {
  const message = messages[locale]?.[key] ?? messages["en"]?.[key];
  if (message === undefined) {
    return key;
  }
  return interpolateMessage(message, params);
}
