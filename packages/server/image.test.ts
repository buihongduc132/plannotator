import { describe, test, expect } from "bun:test";

describe("image validation", () => {
  describe("validateImagePath", () => {
    test("accepts PNG files", async () => {
      const { validateImagePath } = await import("./image");
      const result = validateImagePath("/tmp/test.png");
      expect(result.valid).toBe(true);
      expect(result.resolved).toContain("test.png");
    });

    test("accepts JPEG files", async () => {
      const { validateImagePath } = await import("./image");
      const result = validateImagePath("/tmp/photo.jpg");
      expect(result.valid).toBe(true);
    });

    test("rejects non-image files", async () => {
      const { validateImagePath } = await import("./image");
      const result = validateImagePath("/tmp/document.pdf");
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("rejects files with no extension", async () => {
      const { validateImagePath } = await import("./image");
      const result = validateImagePath("/tmp/README");
      expect(result.valid).toBe(false);
    });

    test("accepts SVG files", async () => {
      const { validateImagePath } = await import("./image");
      const result = validateImagePath("/tmp/icon.svg");
      expect(result.valid).toBe(true);
    });

    test("accepts WebP files", async () => {
      const { validateImagePath } = await import("./image");
      const result = validateImagePath("/tmp/image.webp");
      expect(result.valid).toBe(true);
    });

    test("is case insensitive", async () => {
      const { validateImagePath } = await import("./image");
      const result = validateImagePath("/tmp/IMAGE.PNG");
      expect(result.valid).toBe(true);
    });
  });

  describe("validateUploadExtension", () => {
    test("accepts PNG uploads", async () => {
      const { validateUploadExtension } = await import("./image");
      const result = validateUploadExtension("screenshot.png");
      expect(result.valid).toBe(true);
      expect(result.ext).toBe("png");
    });

    test("rejects unsupported extensions", async () => {
      const { validateUploadExtension } = await import("./image");
      const result = validateUploadExtension("malware.exe");
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    test("defaults to png when no extension", async () => {
      const { validateUploadExtension } = await import("./image");
      const result = validateUploadExtension("file");
      expect(result.ext).toBe("png");
    });
  });
});
