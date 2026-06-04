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

