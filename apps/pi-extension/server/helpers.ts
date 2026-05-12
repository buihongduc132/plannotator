/**
 * Core HTTP helpers for Pi extension servers.
 * parseBody, json, html, send, toWebRequest, detectWSL
 */

import { release } from "node:os";

import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB limit

export function parseBody(
	req: IncomingMessage,
): Promise<Record<string, unknown>> {
	return new Promise((resolve) => {
		let data = "";
		let size = 0;
		req.on("data", (chunk: string) => {
			size += chunk.length;
			if (size > MAX_BODY_SIZE) {
				req.destroy();
				resolve({});
				return;
			}
			data += chunk;
		});
		req.on("end", () => {
			try {
				resolve(JSON.parse(data));
			} catch {
				resolve({});
			}
		});
		req.on("error", () => resolve({}));
	});
}

export function json(
	res: import("node:http").ServerResponse,
	data: unknown,
	status = 200,
): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(data));
}

export function html(
	res: import("node:http").ServerResponse,
	content: string,
): void {
	res.writeHead(200, { "Content-Type": "text/html" });
	res.end(content);
}

export function send(
	res: import("node:http").ServerResponse,
	body: string | Buffer,
	status = 200,
	headers: Record<string, string> = {},
): void {
	res.writeHead(status, headers);
	res.end(body);
}

export function requestUrl(req: IncomingMessage): URL {
	return new URL(req.url ?? "/", "http://localhost");
}

/**
 * Detect whether the current process is running under WSL.
 */
export function detectWSL(): boolean {
	try {
		if (process.platform !== "linux") return false;
		return release().toLowerCase().includes("microsoft");
	} catch { return false; }
}

export function toWebRequest(req: IncomingMessage): Request {
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const item of value) headers.append(key, item);
		} else {
			headers.set(key, value);
		}
	}

	const init: RequestInit & { duplex?: "half" } = {
		method: req.method,
		headers,
	};

	if (req.method !== "GET" && req.method !== "HEAD") {
		init.body = Readable.toWeb(req) as unknown as BodyInit;
		init.duplex = "half";
	}

	return new Request(`http://localhost${req.url ?? "/"}`, init);
}
