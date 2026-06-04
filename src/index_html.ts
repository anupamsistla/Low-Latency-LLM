export const INDEX_HTML = 
`<!doctype html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Low-Latency LLM Proxy</title>
	<style>
		body {
			font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			max-width: 720px;
			margin: 40px auto;
			padding: 0 16px;
			line-height: 1.5;
		}

		textarea {
			width: 100%;
			min-height: 120px;
			font: inherit;
			padding: 12px;
			box-sizing: border-box;
		}

		button {
			margin-top: 12px;
			padding: 8px 14px;
			font: inherit;
			cursor: pointer;
		}

		pre {
			white-space: pre-wrap;
			background: #f5f5f5;
			padding: 12px;
			min-height: 120px;
			border-radius: 6px;
		}
	</style>
</head>
<body>
	<h1>Low-Latency LLM Proxy</h1>

	<p>Enter a prompt below:</p>

	<textarea id="prompt"></textarea>
	<br />
	<button id="send">Send</button>

	<h2>Response</h2>
	<pre id="output"></pre>

	<script>
		const promptEl = document.getElementById("prompt");
		const outputEl = document.getElementById("output");
		const sendButton = document.getElementById("send");

		sendButton.addEventListener("click", async () => {
			outputEl.textContent = "";

			try {
				const response = await fetch("/api/complete", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						prompt: promptEl.value,
					}),
				});

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(errorText || "Request failed");
				}

				if (!response.body) {
					throw new Error("Response body is missing");
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();

				let buffer = "";

				while (true) {
					const { done, value } = await reader.read();

					if (done) {
						break;
					}

					buffer += decoder.decode(value, { stream: true });

					const lines = buffer.split("\\n");
					buffer = lines.pop() || "";

					for (const line of lines) {
						const trimmed = line.trim();

						if (!trimmed.startsWith("data:")) {
							continue;
						}

						const data = trimmed.slice("data:".length).trim();

						if (data === "[DONE]") {
							continue;
						}

						try {
							const parsed = JSON.parse(data);
							const text = parsed.choices?.[0]?.delta?.content;

							if (text) {
								outputEl.textContent += text;
							}
						} catch {
							// Ignore incomplete or non-JSON stream lines.
						}
					}
				}
			} catch (error) {
				outputEl.textContent = error instanceof Error ? error.message : String(error);
			}
		});
	</script>
</body>
</html>`
;