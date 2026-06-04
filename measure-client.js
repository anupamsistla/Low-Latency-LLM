const WORKER_URL = process.argv[2];

if (!WORKER_URL) {
	console.error("Usage: node measure-client.js your-worker-url");
	process.exit(1);
}

const PROMPT = "Complete this sentence: The fastest way to reduce latency is";

async function measureHealthRtt() {
	const start = performance.now();

	const response = await fetch(`${WORKER_URL}/health`);

	if (!response.ok) {
		throw new Error(`/health failed with status ${response.status}`);
	}

	await response.text();

	const end = performance.now();

	return end - start;
}

async function measureClientToFirstChunk() {
	const start = performance.now();

	const response = await fetch(`${WORKER_URL}/api/complete`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			prompt: PROMPT,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`/api/complete failed with status ${response.status}: ${errorText}`
		);
	}

	if (!response.body) {
		throw new Error("Response body is missing");
	}

	const reader = response.body.getReader();

	while (true) {
		const { done, value } = await reader.read();

		if (done) {
			throw new Error("Stream ended before first chunk was received");
		}

		if (value && value.length > 0) {
			const firstChunkAt = performance.now();

			await reader.cancel();

			return firstChunkAt - start;
		}
	}
}

async function run() {
	const healthRttMs = await measureHealthRtt();
	const clientToFirstChunkMs = await measureClientToFirstChunk();

	console.log({
		"health rtt ms": Number(healthRttMs.toFixed(3)),
		"client to first chunk ms": Number(clientToFirstChunkMs.toFixed(3)),
	});
}

run().catch((error) => {
	console.error(error);
	process.exit(1);
});