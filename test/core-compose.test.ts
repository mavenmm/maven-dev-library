import { describe, it, expect } from "vitest";
import { escapeHtml, easternDatePrefix, buildTitle, buildContextHtml, titlePrefixFor, CORE_VERSION } from "../src/core/index";

describe("core compose", () => {
  it("exposes a version", () => { expect(CORE_VERSION).toBe("0.3.0"); });
  it("escapes the dangerous five", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
  it("formats Mon DD in America/Toronto", () => {
    expect(easternDatePrefix(new Date("2026-06-25T12:00:00Z"))).toBe("Jun 25");
  });
  it("builds the task title", () => {
    expect(buildTitle("bug", "Login missing", new Date("2026-06-25T12:00:00Z"))).toBe("(Jun 25) [Bug] Login missing");
  });
  it("maps title prefixes", () => { expect(titlePrefixFor("working_well")).toBe("What's working well"); });
  it("builds the context block (escapes, app, page, userId fallback)", () => {
    const html = buildContextHtml({ name: "A <b>", email: "a@x.com" }, { appName: "Maven Home", pageUrl: "https://h/x?q=1&y=2", pageTitle: "Home", userAgent: "UA", viewport: "800x600" });
    expect(html).toContain("<strong>Submitted by:</strong> A &lt;b&gt; (a@x.com)");
    expect(html).toContain("<strong>App:</strong> Maven Home");
    expect(html).toContain('href="https://h/x?q=1&amp;y=2"');
    expect(html).toContain("<strong>Browser:</strong> UA · 800x600");
    expect(buildContextHtml({ userId: "42" }, { appName: "X", pageUrl: "https://h" })).toContain("user #42");
  });
});
