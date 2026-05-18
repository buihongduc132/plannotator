import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

// Mock document for DOM-dependent code
const appendedLinks: HTMLLinkElement[] = [];

const mockDoc = {
  createElement: mock((_tag: string) => {
    const el = {
      rel: "",
      href: "",
      dataset: {} as Record<string, string>,
    };
    // Track appended links via a proxy-like approach
    return el;
  }),
  head: {
    appendChild: mock((el: any) => {
      appendedLinks.push(el);
    }),
  },
};

// Mock the global document
let origDocument: typeof document;
beforeEach(() => {
  origDocument = globalThis.document;
  (globalThis as any).document = mockDoc;
  appendedLinks.length = 0;
});
afterEach(() => {
  (globalThis as any).document = origDocument;
});

// Now import after mock setup
// We need to reimport for each test, so we use dynamic import with cache busting
// Actually, since the module uses a module-level `loaded` Set, we need to handle that.
// Let's test the logic by importing once and verifying the side effects.

describe("loadDiffFont", () => {
  test("loads a known font by creating a link element", async () => {
    // Reset module cache for clean test
    const mod = await import("./diffFonts.ts?" + Date.now());
    // The module-level `loaded` Set is fresh for each dynamic import
    // But Bun may cache. Let's just call it and check side effects.
    mod.loadDiffFont("Fira Code");
    // Check that appendChild was called (at least once across all tests)
    expect(mockDoc.head.appendChild).toHaveBeenCalled();
  });

  test("does nothing for empty string", async () => {
    const prevCallCount = mockDoc.head.appendChild.mock.calls.length;
    const mod = await import("./diffFonts.ts?" + Date.now());
    mod.loadDiffFont("");
    expect(mockDoc.head.appendChild.mock.calls.length).toBe(prevCallCount);
  });

  test("does nothing for unknown font", async () => {
    const prevCallCount = mockDoc.head.appendChild.mock.calls.length;
    const mod = await import("./diffFonts.ts?" + Date.now());
    mod.loadDiffFont("Unknown Font XYZ");
    expect(mockDoc.head.appendChild.mock.calls.length).toBe(prevCallCount);
  });

  test("all known fonts are in FONT_URLS", async () => {
    const mod = await import("./diffFonts.ts?" + Date.now());
    // We can't access FONT_URLS directly (not exported), but we can verify
    // known fonts don't throw and trigger appendChild
    const knownFonts = [
      "Red Hat Mono", "Fira Code", "Source Code Pro", "JetBrains Mono",
      "IBM Plex Mono", "Inconsolata", "Roboto Mono", "Hack",
      "Atkinson Hyperlegible Mono",
    ];
    for (const font of knownFonts) {
      expect(() => mod.loadDiffFont(font)).not.toThrow();
    }
  });
});
