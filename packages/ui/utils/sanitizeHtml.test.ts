/**
 * Tests for sanitizeHtml.ts — HTML sanitization utility
 * Run: bun test packages/ui/utils/sanitizeHtml.test.ts
 *
 * Note: This module depends on DOMPurify (browser DOM) and marked.
 * DOMPurify requires a DOM environment. In Bun test env, we test what we can.
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";

// DOMPurify needs a DOM. In Bun, we need jsdom or similar.
// Since DOMPurify.sanitize is the core function, let's mock it for unit tests.
// and test the integration with marked separately if a DOM is available.

// Mock DOMPurify to test the logic flow
const sanitizedResults: string[] = [];
mock.module("dompurify", () => ({
  default: {
    sanitize: (html: string, options: { ALLOWED_TAGS: string[]; ALLOWED_ATTR: string[] }) => {
      sanitizedResults.push(html);
      return html; // pass-through for testing
    },
  },
  __esModule: true,
}));

const { sanitizeBlockHtml } = await import("./sanitizeHtml");

describe("sanitizeBlockHtml", () => {
  beforeEach(() => {
    sanitizedResults.length = 0;
  });

  test("processes plain text through marked", () => {
    const result = sanitizeBlockHtml("hello world");
    // marked wraps plain text in <p> tags
    expect(result).toContain("hello world");
    expect(sanitizedResults).toHaveLength(1);
  });

  test("processes markdown inside HTML", () => {
    const result = sanitizeBlockHtml("<details><summary>Click</summary>\n**bold**\n</details>");
    expect(result).toContain("Click");
    // The **bold** should be converted to <strong>bold</strong> by marked
    expect(sanitizedResults).toHaveLength(1);
  });

  test("handles empty string", () => {
    const result = sanitizeBlockHtml("");
    expect(result).toBe(""); // marked returns empty for empty input
  });

  test("handles code blocks", () => {
    const result = sanitizeBlockHtml("<details>\n```js\nconsole.log('hi')\n```\n</details>");
    expect(result).toContain("console.log");
    expect(sanitizedResults).toHaveLength(1);
  });

  test("processes HTML with inline markdown", () => {
    const result = sanitizeBlockHtml("<p>This is **bold** and *italic*</p>");
    // marked should convert the markdown
    expect(sanitizedResults).toHaveLength(1);
    expect(result).toContain("bold");
  });

  test("passes marked output through DOMPurify", () => {
    sanitizeBlockHtml("test");
    // DOMPurify.sanitize should have been called
    expect(sanitizedResults).toHaveLength(1);
  });

  test("handles HTML with links", () => {
    const result = sanitizeBlockHtml('<a href="https://example.com">link</a>');
    expect(result).toContain("link");
  });

  test("handles nested HTML structure", () => {
    const html = `<details>
<summary>Expand</summary>
<p>Content with \`code\` inline</p>
<ul>
<li>item 1</li>
<li>item 2</li>
</ul>
</details>`;
    const result = sanitizeBlockHtml(html);
    expect(result).toContain("Expand");
    expect(result).toContain("item 1");
  });
});
