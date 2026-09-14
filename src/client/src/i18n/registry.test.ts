import { describe, expect, it } from "vitest";
import { getLocalePlugin, getSupportedLocales, resolveBrowserLocale } from "./registry";

describe("i18n registry", () => {
  it("returns supported locales list in stable order", () => {
    expect(getSupportedLocales()).toEqual(["en", "zh-CN"]);
  });

  it("finds registered locale plugins by id", () => {
    const en = getLocalePlugin("en");
    expect(en?.id).toBe("en");
    expect(en?.label).toBe("English");

    const zhCN = getLocalePlugin("zh-CN");
    expect(zhCN?.id).toBe("zh-CN");
    expect(zhCN?.label).toBe("简体中文");

    expect(getLocalePlugin("fr")).toBeUndefined();
  });

  it("resolves browser language priority correctly", () => {
    expect(resolveBrowserLocale(["en-US", "en"])).toBe("en");
    expect(resolveBrowserLocale(["zh-CN", "en"])).toBe("zh-CN");
    expect(resolveBrowserLocale(["zh"])).toBe("zh-CN");
    expect(resolveBrowserLocale(["zh-TW"])).toBe("zh-CN");
    expect(resolveBrowserLocale(["zh-HK"])).toBe("zh-CN");
    expect(resolveBrowserLocale(["zh-Hans-CN"])).toBe("zh-CN");
    expect(resolveBrowserLocale(["fr-FR", "zh-CN"])).toBe("zh-CN");
    expect(resolveBrowserLocale(["ja", "ko"])).toBe("en");
    expect(resolveBrowserLocale([])).toBe("en");
  });
});
