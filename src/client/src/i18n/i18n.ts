import type { ReactiveController, ReactiveControllerHost } from "lit";
import { translateMessage, type MessagesByLocale } from "./format";
import { getSupportedLocales, localePlugins, resolveBrowserLocale } from "./registry";
import type { Locale, TranslationParams } from "./types";

export const LOCALE_STORAGE_KEY = "pi-locale";

function detectInitialLocale(): Locale {
  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored === "en" || stored === "zh-CN") {
        return stored;
      }
    }
  } catch {
    // Ignore storage access errors in restricted sandbox
  }

  if (typeof navigator !== "undefined" && Array.isArray(navigator.languages)) {
    return resolveBrowserLocale(navigator.languages);
  }
  return "en";
}

export class I18nManager {
  private currentLocale: Locale;
  private readonly listeners = new Set<(locale: Locale) => void>();
  private readonly messages: MessagesByLocale;

  constructor(initialLocale?: Locale) {
    this.messages = Object.fromEntries(
      localePlugins.map((plugin) => [plugin.id, plugin.messages]),
    );
    this.currentLocale = initialLocale ?? detectInitialLocale();
    this.applyDocumentLang(this.currentLocale);
  }

  getLocale(): Locale {
    return this.currentLocale;
  }

  setLocale(locale: Locale): void {
    if (!getSupportedLocales().includes(locale)) return;
    if (this.currentLocale === locale) return;

    this.currentLocale = locale;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(LOCALE_STORAGE_KEY, locale);
      }
    } catch {
      // Ignore storage access errors
    }
    this.applyDocumentLang(locale);
    this.notify();
  }

  subscribe(listener: (locale: Locale) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  t(key: string, params?: TranslationParams): string {
    return translateMessage(this.currentLocale, key, this.messages, params);
  }

  resetForTesting(locale: Locale = "en"): void {
    this.listeners.clear();
    this.currentLocale = locale;
    this.applyDocumentLang(locale);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.currentLocale);
    }
  }

  private applyDocumentLang(locale: Locale): void {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }
}

export const i18n = new I18nManager();

export const t = (key: string, params?: TranslationParams): string => i18n.t(key, params);
export const setLocale = (locale: Locale): void => {
  i18n.setLocale(locale);
};

export class I18nController implements ReactiveController {
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {
    this.unsubscribe = i18n.subscribe(() => {
      this.host.requestUpdate();
    });
  }

  hostDisconnected(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  t(key: string, params?: TranslationParams): string {
    return i18n.t(key, params);
  }

  get locale(): Locale {
    return i18n.getLocale();
  }
}
