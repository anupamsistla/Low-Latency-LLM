## Running the Project

### Prerequisites

Before running the project, make sure you have:

* Node.js 22 or later
* A Cloudflare account
* Wrangler installed through npm/npx
* A Groq API key

You can verify your Node version with:

```bash
node -v
```

### 1. Clone the repository

```bash
git clone <repo-url>
cd llm-proxy
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create local environment variables

Create a `.dev.vars` file in the project root:

```bash
touch .dev.vars
```

Add the following values:

```env
MODEL_API_KEY=your_groq_api_key_here
MODEL=llama-3.1-8b-instant
```

`MODEL_API_KEY` is the API key used by the Worker to call the model provider.
`MODEL` is the model name. You can change this to another Groq-supported model.

Do not commit `.dev.vars`.

### 4. Run locally

```bash
npm run dev
```

If the project does not have an npm script for local development, run:

```bash
npx wrangler dev
```

The local Worker should be available at:

```text
http://localhost:8787
```

Open the browser at:

```text
http://localhost:8787
```

This loads the minimal frontend. Enter a prompt and submit it to stream a response through the Worker proxy.

### 5. Test the health endpoint

```bash
curl http://localhost:8787/health
```

Expected response:

```json
{"ok":true}
```

### 6. Test the streaming proxy endpoint locally

```bash
curl -N -X POST http://localhost:8787/api/complete \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Complete this sentence: The fastest way to reduce latency is"}'
```

The `-N` flag disables curl buffering so streamed chunks appear as they arrive.

### 7. Configure the deployed Worker secret

For deployment, set the model API key as a Cloudflare Worker secret:

```bash
npx wrangler secret put MODEL_API_KEY
```

Paste your Groq API key when prompted.

The model name is configured as a normal Worker variable in `wrangler.jsonc`:

```jsonc
"vars": {
  "MODEL": "llama-3.1-8b-instant"
}
```

### 8. Deploy to Cloudflare Workers

```bash
npx wrangler deploy
```

After deployment, Wrangler will print the deployed Worker URL, for example:

```text
https://llm-proxy.<your-subdomain>.workers.dev
```

### 9. Test the deployed Worker

Health check:

```bash
curl https://llm-proxy.<your-subdomain>.workers.dev/health
```

Streaming request:

```bash
curl -N -X POST https://llm-proxy.<your-subdomain>.workers.dev/api/complete \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Complete this sentence: The fastest way to reduce latency is"}'
```

### 10. View Worker logs

To view proxy-side latency logs from the deployed Worker:

```bash
npx wrangler tail
```

The Worker logs timing values such as:

```text
proxy to model headers ms
model to proxy first chunk ms
```

These are used to understand where latency occurs in the proxy-to-provider path.

### 11. Run client-side latency measurement

The repository includes a simple client-side measurement script:

```bash
node measure-client.js https://llm-proxy.<your-subdomain>.workers.dev
```

It reports:

```text
health rtt ms
client to first chunk ms
```

`health rtt ms` measures a lightweight client-to-proxy round trip using `/health`.

`client to first chunk ms` measures the time from sending the prompt to receiving the first streamed response body chunk.
