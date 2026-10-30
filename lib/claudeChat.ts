import Anthropic from "@anthropic-ai/sdk";
import { Config } from "./catalog";
import { buildSummary, ChatEvent, MAX_TOOL_ROUNDS, runTool, SYSTEM, toolSpecs } from "./assistant";

type MessageParam = Anthropic.Beta.BetaMessageParam;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const tools: Anthropic.Beta.BetaTool[] = toolSpecs.map((spec) => ({
  name: spec.name,
  description: spec.description,
  eager_input_streaming: true,
  input_schema: spec.parameters as Anthropic.Beta.BetaTool.InputSchema,
}));
let client: Anthropic | undefined;

export async function claudeChat(history: unknown[], text: string, start: Config, emit: (event: ChatEvent) => void) {
  client ??= new Anthropic();
  const state = { config: start };
  // History is append-only: earlier turns (including thinking blocks) are
  // sent back exactly as the API returned them.
  const messages: MessageParam[] = [
    ...(history as MessageParam[]),
    {
      role: "user",
      content: [
        { type: "text", text: `[Current build: ${JSON.stringify(buildSummary(state.config))}]` },
        { type: "text", text },
      ],
    },
  ];
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        cache_control: { type: "ephemeral" },
        system: SYSTEM,
        tools,
        messages,
      });
      response.on("text", (delta) => emit({ type: "text", text: delta }));
      const message = await response.finalMessage();
      messages.push({ role: "assistant", content: message.content });

      if (message.stop_reason === "refusal") {
        emit({ type: "text", text: "Sorry, I can't help with that. Shall we get back to your car?" });
        break;
      }
      const calls = message.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use");
      if (!calls.length) break;
      if (message.stop_reason === "max_tokens") throw new Error("The reply was cut off. Please try again.");

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = calls.map((call) => {
        const { result, isError } = runTool(call.name, (call.input ?? {}) as Record<string, unknown>, state, emit);
        return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result), ...(isError ? { is_error: true } : {}) };
      });
      messages.push({ role: "user", content: results });
    }
    emit({ type: "done", messages });
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Anthropic.AuthenticationError ? "The assistant is not configured. Check ANTHROPIC_API_KEY on the server."
      : error instanceof Anthropic.RateLimitError ? "The assistant is busy. Please try again in a moment."
      : error instanceof Anthropic.APIError ? "The assistant is unavailable right now. Please try again."
      : error instanceof Error ? error.message : "Something went wrong.";
    emit({ type: "error", message });
  }
}
