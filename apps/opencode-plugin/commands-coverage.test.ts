import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

const startAnnotateServerMock = mock(async (_options: any) => ({
	waitForDecision: async () => ({ feedback: "", annotations: [], exit: false, approved: false }),
	stop: mock(() => {}),
}));

mock.module("@plannotator/server/annotate", () => ({
	startAnnotateServer: startAnnotateServerMock,
	handleAnnotateServerReady: () => {},
}));

// Mock review server (uses Bun-specific syntax that breaks in test context)
mock.module("@plannotator/server/review", () => ({
	startReviewServer: mock(async (_options: any) => ({
		waitForDecision: async () => ({ feedback: "", exit: false, approved: false }),
		stop: mock(() => {}),
	})),
	handleReviewServerReady: () => {},
}));

// Mock server module (also uses Bun-specific syntax)
mock.module("@plannotator/server", () => ({
	startPlannotatorServer: mock(async (_options: any) => ({
		waitForDone: async () => {},
		stop: mock(() => {}),
	})),
	handleServerReady: () => {},
}));

// Mock git module
mock.module("@plannotator/server/git", () => ({
	getGitContext: async () => ({ defaultBranch: "main" }),
	runGitDiffWithContext: async () => ({ patch: "", label: "test", error: undefined }),
}));

// Mock pr module
mock.module("@plannotator/server/pr", () => ({
	parsePRUrl: () => null,
	checkPRAuth: async () => {},
	fetchPR: async () => ({ rawPatch: "", metadata: undefined }),
	getCliName: () => "gh",
	getMRLabel: () => "PR",
	getMRNumberLabel: () => "#1",
	getDisplayRepo: () => "owner/repo",
}));

const { handleAnnotateCommand, handleAnnotateLastCommand, handleArchiveCommand, handleReviewCommand } = await import("./commands");

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "plannotator-opencode-cmdcov-"));
	tempDirs.push(dir);
	return dir;
}

function makeDeps(overrides: Record<string, any> = {}) {
	return {
		client: {
			app: {
				log: mock((_entry: unknown) => {}),
			},
			session: {
				prompt: mock(async (_input: unknown) => {}),
				messages: mock(async (_input: unknown) => ({
					data: [
						{
							info: { role: "assistant" },
							parts: [{ type: "text", text: "Last assistant text" }],
						},
					],
				})),
			},
		},
		htmlContent: "<html></html>",
		reviewHtmlContent: "<html></html>",
		getSharingEnabled: async () => true,
		getShareBaseUrl: () => undefined,
		getPasteApiUrl: () => undefined,
		directory: undefined as string | undefined,
		...overrides,
	};
}

afterEach(() => {
	startAnnotateServerMock.mockClear();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("handleAnnotateCommand — coverage expansion", () => {
	test("logs error and returns when no arguments provided", async () => {
		const logMock = mock((_entry: unknown) => {});
		const deps = makeDeps({
			client: {
				app: { log: logMock },
				session: { prompt: mock(async () => {}), messages: mock(async () => ({ data: [] })) },
			},
		});

		await handleAnnotateCommand({ properties: { arguments: "" } }, deps);

		expect(startAnnotateServerMock).not.toHaveBeenCalled();
		expect(logMock).toHaveBeenCalled();
		const errorCalls = logMock.mock.calls.filter((c: any[]) => c[0]?.level === "error");
		expect(errorCalls.length).toBeGreaterThan(0);
	});

	test("logs error and returns for non-existent markdown file", async () => {
		const logMock = mock((_entry: unknown) => {});
		const projectRoot = makeTempDir();
		const deps = makeDeps({
			directory: projectRoot,
			client: {
				app: { log: logMock },
				session: { prompt: mock(async () => {}), messages: mock(async () => ({ data: [] })) },
			},
		});

		await handleAnnotateCommand(
			{ properties: { arguments: "nonexistent-file.md" } },
			deps,
		);

		expect(startAnnotateServerMock).not.toHaveBeenCalled();
		const errorCalls = logMock.mock.calls.filter((c: any[]) => c[0]?.level === "error");
		expect(errorCalls.length).toBeGreaterThan(0);
	});

	test("annotates a markdown file successfully", async () => {
		const projectRoot = makeTempDir();
		const mdPath = path.join(projectRoot, "plan.md");
		writeFileSync(mdPath, "# My Plan\n\nSome content here.");

		const deps = makeDeps({ directory: projectRoot });

		await handleAnnotateCommand(
			{ properties: { arguments: "plan.md" } },
			deps,
		);

		expect(startAnnotateServerMock).toHaveBeenCalledTimes(1);
		const options = startAnnotateServerMock.mock.calls[0]?.[0];
		expect(options.mode).toBe("annotate");
		expect(options.filePath).toBe(mdPath);
		expect(options.markdown).toContain("My Plan");
	});

	test("rejects folder with no markdown files", async () => {
		const projectRoot = makeTempDir();
		const emptyFolder = path.join(projectRoot, "empty-dir");
		mkdirSync(emptyFolder, { recursive: true });
		writeFileSync(path.join(emptyFolder, "data.csv"), "a,b,c");

		const logMock = mock((_entry: unknown) => {});
		const deps = makeDeps({
			directory: projectRoot,
			client: {
				app: { log: logMock },
				session: { prompt: mock(async () => {}), messages: mock(async () => ({ data: [] })) },
			},
		});

		await handleAnnotateCommand(
			{ properties: { arguments: "empty-dir/" } },
			deps,
		);

		expect(startAnnotateServerMock).not.toHaveBeenCalled();
		const errorCalls = logMock.mock.calls.filter((c: any[]) => c[0]?.level === "error");
		expect(errorCalls.length).toBeGreaterThan(0);
	});

	test("passes sessionId to server from event properties", async () => {
		const projectRoot = makeTempDir();
		const mdPath = path.join(projectRoot, "doc.md");
		writeFileSync(mdPath, "# Doc");

		const deps = makeDeps({ directory: projectRoot });

		await handleAnnotateCommand(
			{ properties: { arguments: "doc.md", sessionID: "ses-abc-123" } },
			deps,
		);

		const options = startAnnotateServerMock.mock.calls[0]?.[0];
		expect(options.sessionId).toBe("ses-abc-123");
	});

	test("passes gate flag when --gate is in arguments", async () => {
		const projectRoot = makeTempDir();
		const mdPath = path.join(projectRoot, "doc.md");
		writeFileSync(mdPath, "# Doc");

		const deps = makeDeps({ directory: projectRoot });

		await handleAnnotateCommand(
			{ properties: { arguments: "doc.md --gate" } },
			deps,
		);

		const options = startAnnotateServerMock.mock.calls[0]?.[0];
		expect(options.gate).toBe(true);
	});

	test("handles HTML file conversion", async () => {
		const projectRoot = makeTempDir();
		const htmlPath = path.join(projectRoot, "spec.html");
		writeFileSync(htmlPath, "<h1>Spec</h1><p>Details here</p>");

		const deps = makeDeps({ directory: projectRoot });

		await handleAnnotateCommand(
			{ properties: { arguments: "spec.html" } },
			deps,
		);

		expect(startAnnotateServerMock).toHaveBeenCalledTimes(1);
		const options = startAnnotateServerMock.mock.calls[0]?.[0];
		expect(options.mode).toBe("annotate");
		expect(options.filePath).toBe(htmlPath);
		expect(options.sourceInfo).toBe("spec.html");
	});

	test("sends feedback to session when feedback result provided", async () => {
		const projectRoot = makeTempDir();
		const mdPath = path.join(projectRoot, "doc.md");
		writeFileSync(mdPath, "# Doc");

		const promptMock = mock(async (_input: unknown) => {});
		startAnnotateServerMock.mockResolvedValueOnce({
			waitForDecision: async () => ({
				feedback: "Please revise section 1",
				annotations: [],
				exit: false,
				approved: false,
			}),
			stop: mock(() => {}),
		});

		const deps = makeDeps({
			directory: projectRoot,
			client: {
				app: { log: mock(() => {}) },
				session: {
					prompt: promptMock,
					messages: mock(async () => ({ data: [] })),
				},
			},
		});

		await handleAnnotateCommand(
			{ properties: { arguments: "doc.md", sessionID: "ses-xyz-456" } },
			deps,
		);

		expect(promptMock).toHaveBeenCalledTimes(1);
		const call = promptMock.mock.calls[0]?.[0];
		expect(call.body.parts[0].text).toContain("Please revise section 1");
	});
});

describe("handleAnnotateLastCommand — coverage expansion", () => {
	test("returns null when no sessionID", async () => {
		const logMock = mock((_entry: unknown) => {});
		const deps = makeDeps({
			client: {
				app: { log: logMock },
				session: { prompt: mock(async () => {}), messages: mock(async () => ({ data: [] })) },
			},
		});

		const result = await handleAnnotateLastCommand(
			{ properties: {} },
			deps,
		);

		expect(result).toBeNull();
		expect(startAnnotateServerMock).not.toHaveBeenCalled();
	});

	test("returns null when no assistant messages in session", async () => {
		const deps = makeDeps({
			client: {
				app: { log: mock(() => {}) },
				session: {
					prompt: mock(async () => {}),
					messages: mock(async () => ({
						data: [
							{ info: { role: "user" }, parts: [{ type: "text", text: "hello" }] },
						],
					})),
				},
			},
		});

		const result = await handleAnnotateLastCommand(
			{ properties: { sessionID: "ses-123" } },
			deps,
		);

		expect(result).toBeNull();
	});

	test("returns feedback when annotate-last succeeds", async () => {
		const deps = makeDeps();
		startAnnotateServerMock.mockResolvedValueOnce({
			waitForDecision: async () => ({
				feedback: "Annotation feedback text",
				annotations: [],
				exit: false,
				approved: false,
			}),
			stop: mock(() => {}),
		});

		const result = await handleAnnotateLastCommand(
			{ properties: { sessionID: "ses-123" } },
			deps,
		);

		expect(result).toBe("Annotation feedback text");
	});

	test("returns null when user exits without feedback", async () => {
		const deps = makeDeps();
		startAnnotateServerMock.mockResolvedValueOnce({
			waitForDecision: async () => ({
				feedback: "",
				annotations: [],
				exit: true,
				approved: false,
			}),
			stop: mock(() => {}),
		});

		const result = await handleAnnotateLastCommand(
			{ properties: { sessionID: "ses-123" } },
			deps,
		);

		expect(result).toBeNull();
	});

	test("returns null when user approves (gate mode)", async () => {
		const deps = makeDeps();
		startAnnotateServerMock.mockResolvedValueOnce({
			waitForDecision: async () => ({
				feedback: "",
				annotations: [],
				exit: false,
				approved: true,
			}),
			stop: mock(() => {}),
		});

		const result = await handleAnnotateLastCommand(
			{ properties: { sessionID: "ses-123", arguments: "--gate" } },
			deps,
		);

		expect(result).toBeNull();
	});

	test("passes gate flag from arguments", async () => {
		const deps = makeDeps();
		startAnnotateServerMock.mockResolvedValueOnce({
			waitForDecision: async () => ({
				feedback: "fb",
				annotations: [],
				exit: false,
				approved: false,
			}),
			stop: mock(() => {}),
		});

		await handleAnnotateLastCommand(
			{ properties: { sessionID: "ses-123", arguments: "--gate" } },
			deps,
		);

		const options = startAnnotateServerMock.mock.calls[0]?.[0];
		expect(options.gate).toBe(true);
	});
});

// We need separate mock instances for review and archive
const startReviewServerMock = mock(async (_options: any) => ({
	waitForDecision: async () => ({ feedback: "", exit: false, approved: false }),
	stop: mock(() => {}),
}));

const startPlannotatorServerMock = mock(async (_options: any) => ({
	waitForDone: async () => {},
	stop: mock(() => {}),
}));
