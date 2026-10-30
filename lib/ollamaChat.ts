import { catalog, Config } from "./catalog";
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
// Small local models describe build changes instead of calling the tool, so
// changes are extracted in a separate structured-output step and applied
// before the model replies. The chat model only gets the read-only tools.
const BUILD_TOOLS = ["update_build", "build_action"];
const tools = toolSpecs.filter((spec) => !BUILD_TOOLS.includes(spec.name)).map((spec) => ({ type: "function", function: spec }));
const updateSchema = toolSpecs.find((spec) => spec.name === "update_build")!.parameters as { properties: Record<string, unknown> };
const extractionFormat = {
  type: "object",
  properties: { ...updateSchema.properties, action: { type: "string", enum: ["none", "checkout", "undo", "reset"] } },
  required: ["action"],
};
const EXTRACT_PROMPT = `Read the customer's latest message and output only the configurator changes they ask for, using catalogue ids. Leave out every field they did not ask to change. Use action "checkout", "undo" or "reset" only when they ask for that, otherwise "none". Questions, comparisons and searches are not changes.

${SYSTEM.slice(SYSTEM.indexOf("Configurable models:"))}`;

const CHAT_SYSTEM = `${SYSTEM}

In this setup the configurator applies build changes for you before you reply. Never claim a change unless a "Build update result" lists it as applied.`;

// Backstop for weak extraction: a short reply like "ex60" or "black" that names
// exactly one catalogue model or colour is applied directly.
function directMentions(text: string) {
  const lower = text.toLowerCase();
  const found: Record<string, string> = {};
  const models = catalog.models.filter((model) => new RegExp(`\\b${model.id}\\b`).test(lower));
  if (models.length === 1) found.model = models[0].id;
  const colors = catalog.colors.filter((color) => color.name.toLowerCase().split(" ").some((word) => new RegExp(`\\b${word}\\b`).test(lower)));
  if (colors.length === 1) found.color = colors[0].id;
  return found;
}

async function extractChanges(messages: OllamaMessage[]) {
  const response = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: EXTRACT_PROMPT }, ...messages.slice(-5)], format: extractionFormat, stream: false, options: { temperature: 0 } }),
  });
  if (!response.ok) throw new Error(`Local model error (${response.status}): ${await response.text()}`);
  const data = (await response.json()) as { message?: { content?: string } };
  return JSON.parse(data.message?.content || "{}") as Record<string, unknown>;
}

export async function ollamaChat(history: unknown[], text: string, start: Config, emit: (event: ChatEvent) => void) {
  const state = { config: start };
  const messages: OllamaMessage[] = [
    ...(history as OllamaMessage[]),
    { role: "user", content: `[Current build: ${JSON.stringify(buildSummary(state.config))}]\n${text}` },
  ];
  try {
    const changes = { ...(await extractChanges(messages)), ...directMentions(text) };
    console.log("[assistant] extracted", JSON.stringify(changes));
    const notes: string[] = [];
    const { action, ...update } = changes;
    if (Object.values(update).some((value) => (Array.isArray(value) ? value.length : value))) {
      const { result } = runTool("update_build", update, state, emit);
      notes.push(`Build update result: ${JSON.stringify(result)}`);
    }
    if (action === "checkout" || action === "undo" || action === "reset") {
      runTool("build_action", { action }, state, emit);
      notes.push(`Action done: ${action}.`);
    }
    // Tell the chat model what really happened so its reply matches the build.
    if (notes.length) messages.push({ role: "system", content: `${notes.join("\n")}\nTell the customer what was applied and explain anything rejected.` });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: CHAT_SYSTEM }, ...messages], tools, stream: true }),
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
      if (!reply.tool_calls?.length) {
        console.log(`[assistant] replied without tools: ${reply.content.slice(0, 120)}`);
        break;
      }

      for (const call of reply.tool_calls) {
        const args = typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments ?? {};
        const { result } = runTool(call.function.name, args, state, emit);
        console.log(`[assistant] ${call.function.name}`, JSON.stringify(args), "->", JSON.stringify(result));
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
