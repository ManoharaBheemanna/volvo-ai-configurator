import { ChatEvent, isConfig } from "../../../lib/assistant";
import { claudeChat } from "../../../lib/claudeChat";
import { ollamaChat } from "../../../lib/ollamaChat";

// Claude when ANTHROPIC_API_KEY is set; otherwise a free local model through Ollama.
const useClaude = () => !!process.env.ANTHROPIC_API_KEY;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { messages?: unknown[]; message?: string; config?: unknown } | null;
  const text = body?.message?.trim();
  if (!body || !text || !Array.isArray(body.messages) || !isConfig(body.config)) {
    return Response.json({ error: "Expected { messages, message, config }." }, { status: 400 });
  }
  const { messages, config } = body;
  const chat = useClaude() ? claudeChat : ollamaChat;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      await chat(messages, text.slice(0, 2000), config, emit);
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
