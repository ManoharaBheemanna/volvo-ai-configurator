import catalogSnapshot from "../data/volvo-uk-catalog.json";
import { catalog, Config, find, Item } from "./catalog";
import { normalizeConfigForModel, total, validateItem } from "./configEngine";

// Provider-neutral assistant pieces shared by the Claude and local-model chat loops.
export type SnapshotCar = { id: string; name: string; type: string; price: number; seats: number; rangeMiles: number | null; batteryKwh: number | null; chargingSpeedKw: number | null };
export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "config"; config: Config; notice: string }
  | { type: "comparison"; cars: SnapshotCar[] }
  | { type: "suggestions"; replies: string[] }
  | { type: "action"; action: "checkout" | "undo" | "reset" }
  // History is opaque to the browser: its shape depends on the provider.
  | { type: "done"; messages: unknown[] }
  | { type: "error"; message: string };
export type ToolSpec = { name: string; description: string; parameters: Record<string, unknown> };

export const MAX_TOOL_ROUNDS = 8;
const cars = catalogSnapshot.models as SnapshotCar[];

const describe = (items: Item[]) =>
  items
    .map((item) => {
      const rules = [
        item.requiresTrim && `needs trim ${item.requiresTrim.join("/")}`,
        item.availableFor && `only on ${item.availableFor.join(", ")}`,
        item.incompatibleWith && `conflicts with ${item.incompatibleWith.join(", ")}`,
      ].filter(Boolean);
      return `- ${item.id}: ${item.name} (+£${item.priceDelta})${rules.length ? ` [${rules.join("; ")}]` : ""}`;
    })
    .join("\n");

// Static text only, so the prompt prefix stays cacheable across requests.
export const SYSTEM = `You are a friendly car advisor for a Volvo Cars UK configurator prototype. Help the customer find the right model, then configure it, through natural conversation.

How to talk:
- Keep replies short (1-3 sentences). Plain text, no markdown.
- Ask at most one question at a time, and only when you need the answer to make progress. If the request is clear, act on it.
- Remember what the customer already told you; never ask for it again.
- Briefly explain why a recommendation fits their needs.
- After replying, call suggest_replies with 2-4 short things the customer is likely to say next.

Facts and actions:
- Never state a price, range, battery size, seat count or charging speed that did not come from a tool result in this conversation. If a figure is null, say it is not published in this prototype.
- Use search_cars to find or rank models and compare_cars when the customer weighs two or more models.
- Use update_build for every change to the build. The configurator enforces the rules; if it rejects a change, explain why in simple terms and offer the closest valid alternative.
- Use build_action when the customer wants to go to checkout, undo the last change, or start over.
- Prices are indicative. Finance, availability and ordering need Volvo's live systems; say so if asked.
- If the customer goes off-topic, steer back politely.

Configurable models: ${catalog.models.map((model) => `${model.id} (${model.name})`).join(", ")}. Plug-in hybrid variants (xc60-hybrid, xc90-hybrid) can be recommended but are configured as their base model.
Trims:
${describe(catalog.trims)}
Colours:
${describe(catalog.colors)}
Wheels:
${describe(catalog.wheels)}
Options:
${describe(catalog.options)}`;

const str = (value: unknown) => (typeof value === "string" ? value : undefined);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const strList = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

function searchCars(input: Record<string, unknown>) {
  const minPrice = num(input.minPrice), maxPrice = num(input.maxPrice), minSeats = num(input.minSeats);
  const bodyType = str(input.bodyType), powertrain = str(input.powertrain);
  const sortBy = (str(input.sortBy) ?? "price") as keyof SnapshotCar;
  const order = str(input.order) === "desc" ? -1 : 1;
  const powertrainLabel = { electric: "Electric", plug_in_hybrid: "Plug-in hybrid", mild_hybrid: "Mild hybrid" }[powertrain ?? ""];
  const matches = cars
    .filter((car) => (minPrice === undefined || car.price >= minPrice) && (maxPrice === undefined || car.price <= maxPrice))
    .filter((car) => minSeats === undefined || car.seats >= minSeats)
    .filter((car) => !bodyType || car.type.toLowerCase().includes(bodyType))
    .filter((car) => !powertrainLabel || car.type.startsWith(powertrainLabel))
    // Unpublished figures always sort last, whatever the direction.
    .sort((a, b) => {
      const x = a[sortBy] as number | null, y = b[sortBy] as number | null;
      if (x === null) return y === null ? 0 : 1;
      if (y === null) return -1;
      return (x - y) * order;
    });
  return { count: matches.length, cars: matches };
}

function updateBuild(input: Record<string, unknown>, start: Config) {
  let config = { ...start, options: [...start.options] };
  const applied: string[] = [], rejected: { item: string; reason: string }[] = [];
  const modelId = str(input.model);
  if (modelId) {
    const model = catalog.models.find((entry) => entry.id === modelId.replace("-hybrid", ""));
    if (model) {
      config = normalizeConfigForModel({ ...config, model: model.id });
      applied.push(model.name);
    } else rejected.push({ item: modelId, reason: "Unknown model." });
  }
  const setSingle = (key: "trim" | "color" | "wheels", group: Item[]) => {
    const id = str(input[key]);
    if (!id) return;
    const item = find(group, id), next = { ...config, [key]: id };
    const check = validateItem(item, next);
    if (!check.valid || !item) return void rejected.push({ item: item?.name ?? id, reason: check.reason ?? "Not available." });
    // A trim change can invalidate wheels and options that needed the old trim.
    config = key === "trim" ? normalizeConfigForModel(next) : next;
    applied.push(item.name);
  };
  setSingle("trim", catalog.trims);
  setSingle("color", catalog.colors);
  setSingle("wheels", catalog.wheels);
  for (const id of strList(input.removeOptions)) {
    if (config.options.includes(id)) {
      config.options = config.options.filter((option) => option !== id);
      applied.push(`removed ${find(catalog.options, id)?.name ?? id}`);
    }
  }
  for (const id of strList(input.addOptions)) {
    const item = find(catalog.options, id);
    if (config.options.includes(id)) continue;
    const check = validateItem(item, config);
    if (!check.valid || !item) rejected.push({ item: item?.name ?? id, reason: check.reason ?? "Not available." });
    else {
      config.options.push(id);
      applied.push(`added ${item.name}`);
    }
  }
  return { config, applied, rejected };
}

export function buildSummary(config: Config) {
  const model = catalog.models.find((entry) => entry.id === config.model);
  return {
    model: model?.name,
    trim: find(catalog.trims, config.trim)?.name,
    colour: find(catalog.colors, config.color)?.name,
    wheels: find(catalog.wheels, config.wheels)?.name,
    options: config.options.map((id) => find(catalog.options, id)?.name ?? id),
    indicativePriceGbp: total(config),
  };
}

export function isConfig(value: unknown): value is Config {
  const config = value as Config;
  return !!config && typeof config.model === "string" && typeof config.trim === "string" && typeof config.color === "string" && typeof config.wheels === "string" && Array.isArray(config.options);
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);
export const toolSpecs: ToolSpec[] = [
  {
    name: "search_cars",
    description: "Search the UK model snapshot. Returns matching models with starting price, seats, powertrain type, WLTP range, battery and DC charging speed.",
    parameters: {
      type: "object",
      properties: {
        minPrice: { type: "number", description: "Minimum starting price in GBP" },
        maxPrice: { type: "number", description: "Maximum starting price in GBP" },
        minSeats: { type: "integer" },
        bodyType: { type: "string", enum: ["suv", "crossover", "estate", "saloon"] },
        powertrain: { type: "string", enum: ["electric", "plug_in_hybrid", "mild_hybrid"] },
        sortBy: { type: "string", enum: ["price", "rangeMiles", "batteryKwh", "chargingSpeedKw", "seats"] },
        order: { type: "string", enum: ["asc", "desc"] },
      },
    },
  },
  {
    name: "compare_cars",
    description: "Show a side-by-side comparison table of 2-4 models to the customer and return their specs.",
    parameters: {
      type: "object",
      properties: { modelIds: { type: "array", items: { type: "string", enum: ids(cars) }, minItems: 2, maxItems: 4 } },
      required: ["modelIds"],
    },
  },
  {
    name: "update_build",
    description: "Change the customer's build. Only include the fields that should change. Changes are applied in order model, trim, colour, wheels, removals, additions, and each one is validated.",
    parameters: {
      type: "object",
      properties: {
        model: { type: "string", enum: ids(catalog.models) },
        trim: { type: "string", enum: ids(catalog.trims) },
        color: { type: "string", enum: ids(catalog.colors) },
        wheels: { type: "string", enum: ids(catalog.wheels) },
        addOptions: { type: "array", items: { type: "string", enum: ids(catalog.options) } },
        removeOptions: { type: "array", items: { type: "string", enum: ids(catalog.options) } },
      },
    },
  },
  {
    name: "build_action",
    description: "Go to checkout, undo the last build change, or reset the build to the starting point.",
    parameters: {
      type: "object",
      properties: { action: { type: "string", enum: ["checkout", "undo", "reset"] } },
      required: ["action"],
    },
  },
  {
    name: "suggest_replies",
    description: "Show 2-4 short quick-reply buttons with what the customer might say next.",
    parameters: {
      type: "object",
      properties: { replies: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 } },
      required: ["replies"],
    },
  },
];

/** Runs one tool call against the current build and returns the JSON result for the model. */
export function runTool(name: string, input: Record<string, unknown>, state: { config: Config }, emit: (event: ChatEvent) => void): { result: unknown; isError: boolean } {
  let result: unknown;
  if (name === "search_cars") result = searchCars(input);
  else if (name === "compare_cars") {
    const picked = cars.filter((car) => strList(input.modelIds).includes(car.id));
    if (picked.length >= 2) emit({ type: "comparison", cars: picked });
    result = picked.length >= 2 ? { shownToCustomer: true, cars: picked } : { error: "Give at least two valid model ids." };
  } else if (name === "update_build") {
    const update = updateBuild(input, state.config);
    state.config = update.config;
    if (update.applied.length) emit({ type: "config", config: state.config, notice: `Assistant updated: ${update.applied.join(", ")}.` });
    result = { applied: update.applied, rejected: update.rejected, build: buildSummary(state.config) };
  } else if (name === "build_action") {
    const action = str(input.action);
    if (action === "checkout" || action === "undo" || action === "reset") {
      emit({ type: "action", action });
      result = { done: action };
    } else result = { error: "Unknown action." };
  } else if (name === "suggest_replies") {
    emit({ type: "suggestions", replies: strList(input.replies).slice(0, 4) });
    result = { shown: true };
  } else result = { error: `Unknown tool ${name}.` };
  return { result, isError: typeof result === "object" && result !== null && "error" in result };
}
