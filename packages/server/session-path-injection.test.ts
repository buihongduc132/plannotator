/**
 * Tests for session path injection into HTML.
 *
 * Verifies that the server correctly injects
 * `<script>window.__PLANNOTATOR_SESSION_PATH__="/s/<slug>"</script>`
 * into HTML responses for session-scoped paths, and omits it for root paths.
 */

import { describe, expect, test, beforeAll, afterAll, afterEach } from "bun:test";
import {
  startPlannotatorServer,
  unregisterSessionContext,
} from "./index";
import type { ServerResult } from "./index";

const TEST_HTML =
  '<!DOCTYPE html><html><head><title>Test</title></head><body><div id="root"></div></body></html>';

let host: ServerResult & { url: string };

beforeAll(async () => {
  const result = await startPlannotatorServer({
    plan: "# Host\n\nHost plan",
    origin: "http-api",
    htmlContent: TEST_HTML,
    mode: "plan",
    sharingEnabled: false,
    cwd: "/tmp/test-session-path-injection-host",
    sessionId: "host-path-injection-001",
    onReady: () => {},
  });
  host = { ...result, url: `http://localhost:${result.port}` };
});

afterAll(() => {
  host?.stop?.();
});

const childSessionIds: string[] = [];

afterEach(() => {
  for (const sid of childSessionIds) {
    unregisterSessionContext(sid);
  }
  childSessionIds.length = 0;
});

async function createSession(
  body: Record<string, string>,
): Promise<{ res: Response; json: any }> {
  const res = await fetch(`${host.url}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  if (res.ok && json.sessionId) {
    childSessionIds.push(json.sessionId);
  }
  return { res, json };
}

// ---------------------------------------------------------------------------
// 1. /s/<slug> HTML contains SESSION_PATH injection
// ---------------------------------------------------------------------------

describe("/s/<slug> HTML contains SESSION_PATH injection", () => {
  test("GET /s/<slug> returns HTML with session path script tag", async () => {
    const { json } = await createSession({
      plan: "# Injection Test\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-injection-1",
      name: "my-plan",
    });
    expect(json.slug).toBe("my-plan");

    const htmlRes = await fetch(`${host.url}/s/my-plan`);
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toContain(
      `window.__PLANNOTATOR_SESSION_PATH__="/s/my-plan"`,
    );
  });

  test("GET /s/<sessionId> returns HTML with session path script tag (UUID routing)", async () => {
    const { json } = await createSession({
      plan: "# UUID Injection Test\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-injection-uuid",
    });
    expect(json.sessionId).toBeDefined();

    const htmlRes = await fetch(`${host.url}/s/${json.sessionId}`);
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toContain(
      `window.__PLANNOTATOR_SESSION_PATH__="/s/${json.sessionId}"`,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. /s/<slug>/api/plan returns correct session data, not archive
// ---------------------------------------------------------------------------

describe("/s/<slug>/api/plan returns correct session data", () => {
  test("session API returns the child session plan, not host plan", async () => {
    const planContent = "# My Plan\n\nReal content";
    const { json } = await createSession({
      plan: planContent,
      mode: "plan",
      cwd: "/tmp/test-correct-session-data",
      name: "correct-data-test",
    });

    const planRes = await fetch(
      `${host.url}/s/${json.slug}/api/plan`,
    );
    expect(planRes.status).toBe(200);
    const plan = await planRes.json();
    expect(plan.plan).toBe(planContent);
    // Must NOT return host plan
    expect(plan.plan).not.toContain("Host plan");
  });
});

// ---------------------------------------------------------------------------
// 3. /s/<name-slug>/api/plan via name-slug resolves to correct session
// ---------------------------------------------------------------------------

describe("/s/<name-slug>/api/plan via name-slug resolves correctly", () => {
  test("name-slug routing returns the named session's plan", async () => {
    const planContent = "# Gemini CLI Config\n\nConfigure gemini-cli";
    const { json } = await createSession({
      plan: planContent,
      mode: "plan",
      cwd: "/tmp/test-name-slug-resolve",
      name: "gemini-cli-config",
    });
    expect(json.slug).toBe("gemini-cli-config");

    const planRes = await fetch(
      `${host.url}/s/gemini-cli-config/api/plan`,
    );
    expect(planRes.status).toBe(200);
    const plan = await planRes.json();
    expect(plan.plan).toBe(planContent);
    expect(plan.plan).toContain("Gemini CLI Config");
  });
});

// ---------------------------------------------------------------------------
// 4. Root / serves HTML WITHOUT injection
// ---------------------------------------------------------------------------

describe("root / serves HTML WITHOUT session path injection", () => {
  test("GET / returns HTML without __PLANNOTATOR_SESSION_PATH__ script", async () => {
    const htmlRes = await fetch(`${host.url}/`);
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).not.toContain(`__PLANNOTATOR_SESSION_PATH__="`);
  });

  test("GET /api/plan returns host session data (no /s/ prefix)", async () => {
    const planRes = await fetch(`${host.url}/api/plan`);
    expect(planRes.status).toBe(200);
    const plan = await planRes.json();
    expect(plan.plan).toContain("Host plan");
  });
});

// ---------------------------------------------------------------------------
// 5. /s/<nonexistent-slug> HTML still injects path (SPA fallback)
// ---------------------------------------------------------------------------

describe("/s/<nonexistent-slug> HTML still injects path for SPA fallback", () => {
  test("API route for nonexistent session returns 404 JSON", async () => {
    const res = await fetch(
      `${host.url}/s/nonexistent-session-xyz/api/plan`,
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(body.error).toMatch(/session not found/i);
  });

  test("SPA fallback for nonexistent slug injects path in HTML", async () => {
    const htmlRes = await fetch(
      `${host.url}/s/nonexistent-session-xyz`,
    );
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toContain(
      `window.__PLANNOTATOR_SESSION_PATH__="/s/nonexistent-session-xyz"`,
    );
  });
});

// ---------------------------------------------------------------------------
// 6. /s/<slug> with trailing slash also gets injection
// ---------------------------------------------------------------------------

describe("/s/<slug> with trailing slash also gets injection", () => {
  test("GET /s/my-plan/ returns HTML with session path injected", async () => {
    const { json } = await createSession({
      plan: "# Trailing Slash Test\n\nContent",
      mode: "plan",
      cwd: "/tmp/test-trailing-slash",
      name: "trailing-slash-test",
    });

    const htmlRes = await fetch(
      `${host.url}/s/${json.slug}/`,
    );
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toContain(
      `window.__PLANNOTATOR_SESSION_PATH__="/s/${json.slug}"`,
    );
  });
});
