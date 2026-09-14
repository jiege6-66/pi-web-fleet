// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, I18nManager, LOCALE_STORAGE_KEY } from "./i18n";

describe("i18n manager", () => {
  beforeEach(() => {
    localStorage.clear();
    i18n.resetForTesting("en");
  });

  afterEach(() => {
    localStorage.clear();
    i18n.resetForTesting("en");
  });

  it("translates common keys in en and zh-CN", () => {
    i18n.setLocale("en");
    expect(i18n.t("common.ok")).toBe("OK");
    expect(i18n.t("chat.review")).toBe("Review");

    i18n.setLocale("zh-CN");
    expect(i18n.t("common.ok")).toBe("确定");
    expect(i18n.t("chat.review")).toBe("审批");
  });

  it("persists locale to localStorage and updates document lang", () => {
    i18n.setLocale("zh-CN");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");

    i18n.setLocale("en");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("notifies subscribers when locale changes", () => {
    const listener = vi.fn();
    const unsubscribe = i18n.subscribe(listener);

    i18n.setLocale("zh-CN");
    expect(listener).toHaveBeenCalledWith("zh-CN");

    // Setting the same locale again should not notify
    i18n.setLocale("zh-CN");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    i18n.setLocale("en");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("restores locale from localStorage on initialization", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    const manager = new I18nManager();
    expect(manager.getLocale()).toBe("zh-CN");
  });
});
