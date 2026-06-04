# Low-Latency LLM Proxy

This project implements a simple LLM proxy using a Cloudflare Worker.

The request flow is:

```text
client -> Cloudflare Worker proxy -> LLM provider -> Cloudflare Worker proxy -> client
```

The project includes both:

```text
proxy: Cloudflare Worker backend
client: minimal HTML/JavaScript frontend served by the Worker
```

## Model Provider

This implementation uses **Groq** as the LLM provider.

The default model is configured through the `MODEL` environment variable:

```text
MODEL=llama-3.1-8b-instant
```

The model can be changed by updating the `MODEL` value in `wrangler.jsonc` or `.dev.vars`.

## How It Works

The Cloudflare Worker exposes three routes:

```text
GET  /              Serves the minimal frontend
GET  /health        Returns a basic health check response
POST /api/complete  Sends the user prompt to Groq and streams the response back
```

The frontend is intentionally minimal. It contains a text box, a submit button, and an output area.

When the user submits a prompt:

```text
1. The browser sends a POST request to /api/complete.
2. The Cloudflare Worker receives the prompt.
3. The Worker forwards the prompt to Groq.
4. Groq streams the model response back to the Worker.
5. The Worker forwards the streamed response back to the browser.
6. The browser displays the model response in the output area.
```

The Groq API key is not stored in the code. It is read from an environment variable named:

```text
MODEL_API_KEY
```

The model name is configured through:

```text
MODEL
```

## Prerequisites

Before running the project, install or create the following:

```text
Node.js 22 or later
A Cloudflare account
A Groq API key
```

Check your Node version:

```bash
node -v
```

If using `nvm`, switch to Node 22:

```bash
nvm use 22
```

## Local Setup

Clone the repository:

```bash
git clone https://github.com/anupamsistla/Low-Latency-LLM.git
cd llm-proxy
```

Install dependencies:

```bash
npm install
```

Create a `.dev.vars` file in the project root:

```bash
touch .dev.vars
```

Add the following values:

```env
MODEL_API_KEY=your_groq_api_key_here
MODEL=llama-3.1-8b-instant
```

Do not commit `.dev.vars`.

## Run Locally

Start the local Worker:

```bash
npm run dev
```

Or:

```bash
npx wrangler dev
```

The local app should be available at:

```text
http://localhost:8787
```

Open that URL in a browser to use the frontend.

## Deployment Setup

Set the Groq API key as a Cloudflare Worker secret:

```bash
npx wrangler secret put MODEL_API_KEY
```

Paste the Groq API key when prompted.

The model name is configured in `wrangler.jsonc`:

```jsonc
"vars": {
  "MODEL": "llama-3.1-8b-instant"
}
```

To use a different Groq model, update the `MODEL` value.

## Deploy

Deploy the Worker:

```bash
npx wrangler deploy
```

After deployment, Wrangler will print the deployed URL, usually in this format:

```text
https://llm-proxy.<your-subdomain>.workers.dev
```

Open that URL in a browser to use the deployed frontend.

## Project Structure

```text
llm-proxy/
├── src/
│   ├── index.ts        Cloudflare Worker proxy
│   └── index_html.ts   Minimal frontend HTML
├── measure-client.js   Client-side measurement helper
├── package.json
├── wrangler.jsonc
├── README.md
└── .dev.vars           Local secrets, not committed
```

## Per-Step Latency Measurements

I collected latency measurements from repeated runs (20) against the deployed Cloudflare Worker using the same prompt and model configuration.

### Raw Measurements

| Metric                     | Median (ms) | Min (ms) | Max (ms) |
| -------------------------- | ----------: | -------: | -------: |
| proxy to model headers     |     223.000 |   66.000 |  949.000 |
| model to proxy first chunk |       0.000 |    0.000 |    0.000 |
| health rtt ms              |      81.294 |   63.118 |   164.242 |
| client to first chunk ms   |     257.806 |  122.121 | 1061.060 |

### Mapping to the Round Trip

| Round-trip step                | Metric used                                         | Median (ms) | Notes                                                                                                      |
| ------------------------------ | --------------------------------------------------- | ----------: | ---------------------------------------------------------------------------------------------------------- |
| client -> proxy                | health rtt ms / 2                                   |     40.647 | Estimated using half of the `/health` round-trip time.                                                     |
| proxy <-> LLM                  | proxy to model headers + model to proxy first chunk |     223.000 | Measured from when the Worker starts the provider `fetch()` call to when the first streamed chunk arrives. |
| proxy -> client                | health rtt ms / 2                                   |     40.647 | Estimated using half of the `/health` round-trip time.                                                     |
| client -> first streamed chunk | client to first chunk ms                            |     257.806 | Measured from the client starting the `/api/complete` request to receiving the first streamed body chunk.  |

### Measurement Notes

`health rtt ms` was measured by sending a `GET /health` request from the client to the deployed Worker and timing how long it took to receive the response. I used this to estimate the client -> proxy and proxy -> client paths by dividing the round-trip value by 2.

For the proxy <-> LLM timing, I reported the full observable round trip from the Worker to the model provider and back to the Worker’s first streamed chunk. I could not compute proxy -> LLM and LLM -> proxy separately because Groq did not expose provider-side timing information for each path. I also did not divide this value by 2 because that would assume both directions take the same amount of time, which is not necessarily true. 

I included `model to proxy first chunk` in this calculation because some providers may add a delay between sending response headers and streaming the first body chunk. It is calculated as the time between receiving the response headers to getting the first streamed chunk. In my measurements this value was 0 ms, which suggests that Groq sent the response headers and first streamed chunk together. This means that the time the model took to generate the response is convered by `proxy to model headers`

`client to first chunk ms` was measured from the client side. I recorded the time immediately before sending the `POST /api/complete` request, then recorded the time when the first streamed response body chunk was received. I treated this as the main user-facing latency metric because it represents when the user first starts receiving output.

For all timing measurements in both the Worker and client-side script, I used `performance.now()` to record timestamps and compute elapsed time in milliseconds.

## What I Optimized and Tradeoffs

### Streaming responses

I enabled streaming in the request to the model provider so Groq can send chunks of the response as it is being generated. The Worker forwards those chunks directly to the client. This allows the client to start receiving output without waiting for the full response to be generated.

The tradeoff is that the client has to parse a streamed response instead of a simple JSON object.

### Fast model choice

I chose `llama-3.1-8b-instant` because this project is focused on low latency rather than deep reasoning. The tradeoff is that a larger model may produce stronger answers, but would likely increase response time.

### Short output limit

I limited the response with `max_completion_tokens: 64` to keep generations short and closer to an autocomplete-style use case. This also reduces request-to-last-chunk latency, which is useful because the use case only needs a short useful completion.

The tradeoff is that longer responses may be cut off.

### No retries

I did not add retries in the main request path because retries can increase latency when a request fails or slows down. The tradeoff is that the proxy is less fault-tolerant, but for autocomplete a late response is often less useful than failing quickly.

## What Matters for an Autocomplete Use Case and How That Shaped My Approach

For an autocomplete use case, the most important metric is time to first useful output. A suggestion that arrives late, after the user has already continued typing is not very useful as outlined by the project description.

Because the prompt is user-controlled in this project, I did not try to optimize the content of the first few tokens with heavy prompt engineering. Instead, I focused on reducing the time before any useful output could start reaching the client.

That shaped two main choices: enabling streaming from the model provider and choosing a fast model, `llama-3.1-8b-instant`. Streaming helps the response start reaching the client as soon as chunks are available, and the fast model reduces the provider-side delay before output begins.

## What I Would Do With More Time

With more time, I would test multiple model providers and regions to compare time to first chunk more systematically. This would help optimize provider choice for the lowest latency path.

I would also research better instrumentation/methods for separating the proxy -> LLM and LLM -> proxy paths. My current method measures the observable round trip from the Worker to the provider and back, but it does not cleanly separate the two directions.

## Bonus: Other Proxy Hosting Options

### AWS Lambda + API Gateway

AWS Lambda + API Gateway would give more control over deployment regions and infra, plus strong observability through AWS tooling. It would also integrate well with other AWS services, but the tradeoff is more setup and possible added latency from API Gateway overhead or Lambda cold starts.

### Fly.io

Fly.io could also run the proxy in selected regions, giving more control over where the proxy is placed relative to users or the model provider. The tradeoff is that I would need to manage regional deployment and scaling more directly, while Cloudflare Workers handles edge placement more automatically.

This approach could reduce proxy <-> LLM latency if the proxy is placed in a region closer to the model provider. A similar argument can be made for the AWS Lambda + API Gateway approach as well.

## Final Note: Running Timing Checks

### Client-side timing

The client-side timing script measures:

```text
health rtt ms
client to first chunk ms
```

For local testing, run the Worker locally:

```bash
npm run dev
```

Then run:

```bash
node measure-client.js http://localhost:8787
```

For deployed testing, use the deployed Worker URL instead:

```bash
node measure-client.js https://llm-proxy.<your-subdomain>.workers.dev
```

The script works the same way in both cases. The only difference is the Worker URL.

### Proxy-side timing

The Worker logs proxy-side timing values:

```text
proxy to model headers ms
model to proxy first chunk ms
```

For local testing, run:

```bash
npm run dev
```

Then send a request to the local Worker:

```bash
curl -N -X POST http://localhost:8787/api/complete \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Complete this sentence: The fastest way to reduce latency is"}'
```

The timing logs will appear in the local Wrangler terminal.

For deployed testing, start log streaming:

```bash
npx wrangler tail
```

Then send a request to the deployed Worker:

```bash
curl -N -X POST https://llm-proxy.<your-subdomain>.workers.dev/api/complete \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Complete this sentence: The fastest way to reduce latency is"}'
```

The timing logs will appear in the `wrangler tail` output.
