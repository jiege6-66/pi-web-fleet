import { describe, expect, it } from "vitest";
import { interpolateMessage, translateMessage } from "./format";

describe("i18n format", () => {
  describe("interpolateMessage", () => {
    it("interpolates named tokens", () => {
      expect(interpolateMessage("Showing {count} items", { count: 5 })).toBe("Showing 5 items");
      expect(interpolateMessage("{visible} of {total}", { visible: 10, total: 100 })).toBe("10 of 100");
    });

    it("leaves missing parameters untouched", () => {
      expect(interpolateMessage("Hello {name} {role}", { name: "Alice" })).toBe("Hello Alice {role}");
    });

    it("returns message unchanged when no params are given", () => {
      expect(interpolateMessage("Simple message")).toBe("Simple message");
    });
  });

  describe("translateMessage", () => {
    const testMessages = {
      en: {
        "hello": "Hello {name}!",
        "englishOnly": "Only in English",
      },
      "zh-CN": {
        "hello": "你好，{name}！",
      },
    };

    it("translates for the requested locale", () => {
      expect(translateMessage("zh-CN", "hello", testMessages, { name: "张三" })).toBe("你好，张三！");
      expect(translateMessage("en", "hello", testMessages, { name: "Bob" })).toBe("Hello Bob!");
    });

    it("falls back to en when missing in target locale", () => {
      expect(translateMessage("zh-CN", "englishOnly", testMessages)).toBe("Only in English");
    });

    it("falls back to key itself when missing in both locales", () => {
      expect(translateMessage("zh-CN", "unknown.key", testMessages)).toBe("unknown.key");
      expect(translateMessage("en", "unknown.key", testMessages)).toBe("unknown.key");
    });
  });
});
