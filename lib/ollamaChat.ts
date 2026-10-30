import { Config } from "./catalog";
import { buildSummary, ChatEvent, MAX_TOOL_ROUNDS, runTool, SYSTEM, toolSpecs } from "./assistant";

// Free local model through Ollama (https://ollama.com) running on the same machine.
type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
};

const BASE_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";
const tools = toolSpecs.map((spec) => ({ type: "function", function: spec }));

export async function ollamaChat(history: unknown[], text: string, start: Config, emit: (event: ChatEvent) => void) {
  const state = { config: start };
  const messages: OllamaMessage[] = [
    ...(history as OllamaMessage[]),
    { role: "user", content: `[Current build: ${JSON.stringify(buildSummary(state.config))}]\n${text}` },
  ];
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: SYSTEM }, ...messages], tools, stream: true }),
      });
      if (!response.ok || !response.body) throw new Error(`Local model error (${response.status}): ${await response.text()}`);

      const reply: OllamaMessage = { role: "assistant", content: "" };
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const chunk = JSON.parse(line) as { message?: OllamaMessage; error?: string };
          if (chunk.error) throw new Error(chunk.error);
          if (chunk.message?.content) {
            reply.content += chunk.message.content;
            emit({ type: "text", text: chunk.message.content });
          }
          if (chunk.message?.tool_calls?.length) reply.tool_calls = [...(reply.tool_calls ?? []), ...chunk.message.tool_calls];
        }
      }
      messages.push(reply);
      if (!reply.tool_calls?.length) break;

      for (const call of reply.tool_calls) {
        const { result } = runTool(call.function.name, call.function.arguments ?? {}, state, emit);
        messages.push({ role: "tool", tool_name: call.function.name, content: JSON.stringify(result) });
      }
    }
    emit({ type: "done", messages });
  } catch (error) {
    console.error(error);
    const unreachable = error instanceof TypeError && /fetch failed/i.test(error.message);
    emit({ type: "error", message: unreachable ? `Can't reach Ollama at ${BASE_URL}. Is it running?` : error instanceof Error ? error.message : "Something went wrong." });
  }
}
