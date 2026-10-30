# X5 Electric Configurator — Phase 1

This is the static, deployable shell from the architecture brief. It includes a single fictional model, valid option dependencies, live configuration price calculation, and the `/configure` experience. It does **not** include an OpenAI key, live inventory, financing calculations, or vehicle-order functionality.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`, then select **Start configuring**.

## Publish on Vercel

1. Create a private GitHub repository and push this folder to it.
2. In Vercel, select **Add New → Project**, then import that repository.
3. Keep the detected framework as **Next.js** and deploy. No environment variables are required for Phase 1.
4. Set the deployment to private or password-protected for internal team review.

Before a public release, replace the fictional `X5 Electric` catalogue, add brand-approved imagery/copy, and complete the Phase 2 AI integration using a server-side API key.
# Conversational assistant (Claude)

The chat on `/configure` is powered by Claude through `POST /api/chat`.

1. Copy `.env.local.example` to `.env.local` and set `ANTHROPIC_API_KEY`. Never use `NEXT_PUBLIC_` for this key.
2. Run `pnpm dev` and open `http://localhost:3000/configure`.

Claude runs the conversation and calls tools for every fact and change: `search_cars`, `compare_cars`, `update_build`, `build_action` and `suggest_replies`. Every build change goes through `lib/configEngine.ts`, so the assistant cannot create an invalid configuration. Replies stream to the browser as newline-delimited JSON events.
