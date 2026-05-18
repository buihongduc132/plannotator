import { describe, test, expect } from "bun:test";
import { compress, decompress } from "./compress";

describe("compress / decompress", () => {
  test("round-trips a simple object", async () => {
    const data = { hello: "world", count: 42 };
    const compressed = await compress(data);
    const result = await decompress(compressed);
    expect(result).toEqual(data);
  });

  test("round-trips a string", async () => {
    const data = "hello world";
    const compressed = await compress(data);
    const result = await decompress(compressed);
    expect(result).toBe(data);
  });

  test("round-trips an array", async () => {
    const data = [1, "two", { three: 3 }];
    const compressed = await compress(data);
    const result = await decompress(compressed);
    expect(result).toEqual(data);
  });

  test("round-trips null", async () => {
    const compressed = await compress(null);
    const result = await decompress(compressed);
    expect(result).toBeNull();
  });

  test("round-trips empty object", async () => {
    const compressed = await compress({});
    const result = await decompress(compressed);
    expect(result).toEqual({});
  });

  test("round-trips nested structure", async () => {
    const data = {
      a: { b: { c: [1, 2, 3] } },
      d: null,
      e: true,
      f: false,
    };
    const compressed = await compress(data);
    const result = await decompress(compressed);
    expect(result).toEqual(data);
  });

  test("compressed output is base64url encoded", async () => {
    const compressed = await compress({ test: true });
    expect(compressed).not.toContain("+");
    expect(compressed).not.toContain("/");
    expect(compressed).not.toContain("=");
    expect(compressed).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("different inputs produce different outputs", async () => {
    const c1 = await compress({ a: 1 });
    const c2 = await compress({ a: 2 });
    expect(c1).not.toBe(c2);
  });

  test("handles large payloads", async () => {
    const data = { big: "x".repeat(50000) };
    const compressed = await compress(data);
    const result = await decompress(compressed);
    expect(result).toEqual(data);
  });

  test("handles unicode content", async () => {
    const data = { emoji: "🌍🎉", text: "héllo wörld" };
    const compressed = await compress(data);
    const result = await decompress(compressed);
    expect(result).toEqual(data);
  });
});
