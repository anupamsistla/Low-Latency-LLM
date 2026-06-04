import {INDEX_HTML} from "./index_html"
export interface Env {
	MODEL_API_KEY: string;
	MODEL?: string;
}

type CompleteRequestBody = {
	prompt?: string;
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === "GET" && url.pathname === "/") {
			return new Response(INDEX_HTML, {
				status: 200,
				headers: {
					"Content-Type": "text/html; charset=utf-8",
				},
			});
		}

		if (request.method === "GET" && url.pathname === "/health") {
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: {
					"Content-Type": "application/json",
				},
			});
		}

		if (request.method === "POST" && url.pathname === "/api/complete") {
			return handleComplete(request, env);
		}

		return new Response("Not found", { status: 404 });
	},
};

async function handleComplete(request: Request, env: Env): Promise<Response> {
	if (!env.MODEL_API_KEY) {
		return new Response("Missing model api key", { status: 500 });
	}

	let body: CompleteRequestBody;

	try {
		body = await request.json();
	} catch {
		return new Response("Invalid JSON body", { status: 400 });
	}

	const prompt = body.prompt?.trim();

	if (!prompt) {
		return new Response("Missing prompt, prompt required to communicate with LLM", {
			status: 400,
		});
	}

	const modelFetchStart = performance.now();

	const modelResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${env.MODEL_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: env.MODEL || "llama-3.1-8b-instant",
			messages: [
				{
					role: "user",
					content: prompt,
				},
			],
			temperature: 0.2,
			max_completion_tokens: 64,
			stream: true,
		}),
	});

	const modelHeadersReceived = performance.now();

	const proxyToModelHeadersMs = modelHeadersReceived - modelFetchStart;

	console.log("proxy to model headers ms", proxyToModelHeadersMs.toFixed(10));

	if (!modelResponse.ok || !modelResponse.body) {
		const errorText = await modelResponse.text();

		return new Response(errorText || "Model request failed", {
			status: modelResponse.status,
			headers: {
				"Content-Type": "text/plain",
			},
		});
	}

	const measuredStream = measureFirstChunkOnly(
		modelResponse.body,
		modelHeadersReceived
	);

	return new Response(measuredStream, {
		status: modelResponse.status,
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache",
			"Connection": "keep-alive",
			"Server-Timing": `proxy to model headers;dur=${proxyToModelHeadersMs.toFixed(10)}`,
		},
	});
}

function measureFirstChunkOnly(
	upstreamBody: ReadableStream<Uint8Array>,
	modelHeadersReceived: number
): ReadableStream<Uint8Array> {
	const reader = upstreamBody.getReader();

	let sawFirstChunk = false;

	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const { done, value } = await reader.read();

			if (done) {
				controller.close();
				return;
			}

			if (!sawFirstChunk) {
				sawFirstChunk = true;

				const firstChunkReceived = performance.now();
				const modelToProxyFirstChunkMs =
					firstChunkReceived - modelHeadersReceived;

				console.log(
					"model to proxy first chunk ms",
					modelToProxyFirstChunkMs.toFixed(10)
				);
			}

			controller.enqueue(value);
		},

		cancel() {
			reader.cancel();
		},
	});
}