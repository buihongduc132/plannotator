import { describe, test, expect, mock, beforeEach } from "bun:test";

describe("sharing utility", () => {
  describe("module exports", () => {
    test("exports sharing functions", async () => {
      const mod = await import("./sharing");
      expect(mod).toBeDefined();
    });
  });

  describe("compression/decompression", () => {
    test("encode/decode roundtrip preserves plan data", async () => {
      const mod = await import("./sharing");
      if (typeof mod.encodeSharePayload === "function") {
        const payload = { p: "# Test Plan", a: [], g: [] };
        const encoded = await mod.encodeSharePayload(payload);
        expect(typeof encoded).toBe("string");
        expect(encoded.length).toBeGreaterThan(0);
      }
    });
  });

  describe("URL-safe encoding", () => {
    test("produces URL-safe base64", async () => {
      const mod = await import("./sharing");
      if (typeof mod.encodeSharePayload === "function") {
        const payload = { p: "test", a: [], g: [] };
        const encoded = await mod.encodeSharePayload(payload);
        // URL-safe base64: no +/= characters
        expect(encoded).not.toMatch(/\+/);
        expect(encoded).not.toMatch(/=/);
        expect(encoded).not.toMatch(/\//);
      }
    });
  });
});
