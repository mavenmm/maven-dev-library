import { describe, it, expect } from "vitest";
import { CORE_VERSION, ping } from "../src/core/index";

describe("@mavenmm/core scaffold", () => {
  it("exposes a version", () => {
    expect(CORE_VERSION).toBe("0.0.1");
  });
  it("ping returns pong", () => {
    expect(ping()).toBe("pong");
  });
});
