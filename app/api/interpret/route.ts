import { NextResponse } from "next/server";
import catalogSnapshot from "../../../data/volvo-uk-catalog.json";
import { catalog, find } from "../../../lib/catalog";

type VolvoCar = { id: string; name: string; type: string; price: number; seats: number; rangeMiles: number | null; batteryKwh: number | null; chargingSpeedKw: number | null };
// UK starting-variant snapshot. Null means the figure is not comparable for
// that powertrain in this prototype; it must not be invented in conversation.
const legacyVolvoUkModels: VolvoCar[] = [
  { id: "ex30", name: "EX30", type: "Electric SUV", price: 33060, seats: 5, rangeMiles: 209.4, batteryKwh: 51, chargingSpeedKw: 150 },
  { id: "xc40", name: "XC40", type: "Mild hybrid SUV", price: 32860, seats: 5, rangeMiles: null, batteryKwh: null, chargingSpeedKw: null },
  { id: "ex40", name: "EX40", type: "Electric SUV", price: 42360, seats: 5, rangeMiles: 356, batteryKwh: 82, chargingSpeedKw: 200 },
  { id: "ec40", name: "EC40", type: "Electric crossover", price: 44860, seats: 5, rangeMiles: 300.1, batteryKwh: 70, chargingSpeedKw: 200 },
  { id: "v60", name: "V60", type: "Mild hybrid estate", price: 45210, seats: 5, rangeMiles: null, batteryKwh: null, chargingSpeedKw: null },
  { id: "xc60", name: "XC60", type: "Mild hybrid SUV", price: 49860, seats: 5, rangeMiles: null, batteryKwh: null, chargingSpeedKw: null },
  { id: "xc60-hybrid", name: "XC60", type: "Plug-in hybrid SUV", price: 53265, seats: 5, rangeMiles: 47.2, batteryKwh: 19, chargingSpeedKw: null },
  { id: "ex60", name: "EX60", type: "Electric SUV", price: 56860, seats: 5, rangeMiles: 379.7, batteryKwh: 83, chargingSpeedKw: 350 },
  { id: "es90", name: "ES90", type: "Electric saloon", price: 65060, seats: 5, rangeMiles: 412.6, batteryKwh: 92, chargingSpeedKw: 350 },
  { id: "xc90", name: "XC90", type: "Mild hybrid SUV", price: 66270, seats: 7, rangeMiles: null, batteryKwh: null, chargingSpeedKw: null },
  { id: "xc90-hybrid", name: "XC90", type: "Plug-in hybrid SUV", price: 68765, seats: 7, rangeMiles: null, batteryKwh: null, chargingSpeedKw: null },
  { id: "ex90", name: "EX90", type: "Electric SUV", price: 73160, seats: 7, rangeMiles: 351.1, batteryKwh: 92, chargingSpeedKw: 350 }
];
const volvoUkModels = catalogSnapshot.models as VolvoCar[];
const modelIds = ["ex30", "xc40", "ex40", "ec40", "v60", "xc60", "xc60-hybrid", "ex60", "es90", "xc90", "xc90-hybrid", "ex90"] as const;

type PreferenceState = { seats: number | null; budgetGbp: number | null; powertrain: string | null; colour: string | null; driving: string | null; charging: string | null; model: string | null; pricePreference: "lowest" | "highest" | null };
type SessionState = { lastResults: VolvoCar[]; activeComparison: VolvoCar[]; activeConfig: string | null; lastFinancing: unknown | null };
const sessions = new Map<string, SessionState>();
const emptySession = (): SessionState => ({ lastResults: [], activeComparison: [], activeConfig: null, lastFinancing: null });
const stateSummary = (state: SessionState) => state.activeComparison.length
  ? `Active comparison: ${state.activeComparison.map(car=>`${car.name} (£${car.price.toLocaleString("en-GB")}, ${car.rangeMiles === null ? "range unavailable" : `${car.rangeMiles}mi`})`).join(", ")}.`
  : state.lastResults.length ? `Last search: ${state.lastResults.map(car=>car.name).join(", ")}.`
  : state.activeConfig ? `Active configuration: ${state.activeConfig.toUpperCase()}.` : "No active vehicle state.";
const emptyPreferenceState: PreferenceState = { seats: null, budgetGbp: null, powertrain: null, colour: null, driving: null, charging: null, model: null, pricePreference: null };
type ComparableAttribute = "price" | "seats" | "rangeMiles" | "batteryKwh" | "chargingSpeedKw";
type AttributeQuery = { key: ComparableAttribute; label: string; direction: "asc" | "desc"; winnerDescription: string };

function comparisonAttributeFor(message: string): AttributeQuery | null {
  const lower = message.toLowerCase();
  if (/\b(range|mileage|miles)\b/.test(lower)) return { key: "rangeMiles", label: "Range (WLTP miles)", direction: "desc", winnerDescription: "the longer published range" };
  if (/\b(charging speed|charge speed|fast(?:er|est)? charging|charging)\b/.test(lower)) return { key: "chargingSpeedKw", label: "DC charging speed (kW)", direction: "desc", winnerDescription: "the higher published DC charging speed" };
  if (/\b(battery|battery size|battery capacity|kwh)\b/.test(lower)) return { key: "batteryKwh", label: "Battery (kWh)", direction: "desc", winnerDescription: "the larger battery" };
  if (/\b(seats?|passengers?|roomiest)\b/.test(lower)) return { key: "seats", label: "Seats", direction: "desc", winnerDescription: "the higher seat count" };
  if (/\b(price|cost|cheapest|cheaper|expensive|most expensive|highest price|lowest price)\b/.test(lower)) {
    const direction = /\b(expensive|most expensive|highest price)\b/.test(lower) ? "desc" : "asc";
    return { key: "price", label: "Starting price", direction, winnerDescription: direction === "asc" ? "the lower starting price" : "the higher starting price" };
  }
  return null;
}

function comparisonValue(car: VolvoCar, attribute: ComparableAttribute) {
  return car[attribute];
}

function formatComparisonValue(car: VolvoCar, attribute: ComparableAttribute) {
  const value = comparisonValue(car, attribute);
  if (value === null) return "spec unavailable";
  if (attribute === "price") return `£${value.toLocaleString("en-GB")}`;
  if (attribute === "rangeMiles") return `${value} miles`;
  if (attribute === "batteryKwh") return `${value} kWh`;
  if (attribute === "chargingSpeedKw") return `${value} kW`;
  return `${value}`;
}

function mergePreferenceState(previous: PreferenceState, changes: Partial<PreferenceState>) {
  const next = { ...previous };
  for (const [key, value] of Object.entries(changes)) {
    // null means “not mentioned”; it must never erase an existing preference.
    if (value !== null && value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

type PriceSearch = { priceMin?: number; priceMax?: number; seatsMin?: number; bodyType?: "suv" | "estate" | "saloon" | null; sizeTier?: "small" | "medium" | "large" | null; powertrain?: "electric" | "plug_in_hybrid" | "mild_hybrid" | null; excludeMostExpensive?: boolean; excludeCheapest?: boolean; sortBy: "price"; order: "asc" | "desc"; limit: number };
type ReferenceComparison = { reference: VolvoCar; relation: "little_more_expensive" | "cheaper_than"; search: PriceSearch };

function matchesSizeTier(car: VolvoCar, sizeTier: PriceSearch["sizeTier"]) {
  if (!sizeTier) return true;
  // Product-defined discovery tiers: 90-series large, 60-series medium,
  // 40/30-series small. This is deliberately independent of seat count.
  if (sizeTier === "large") return ["es90", "xc90", "xc90-hybrid", "ex90"].includes(car.id);
  if (sizeTier === "small") return ["ex30", "xc40", "ex40", "ec40"].includes(car.id);
  return ["v60", "xc60", "xc60-hybrid", "ex60"].includes(car.id);
}

function requestedSizeTiersFor(message: string): Array<NonNullable<PriceSearch["sizeTier"]>> {
  const lower = message.toLowerCase();
  if (!/\b(?:car|suv)s?\b/.test(lower)) return [];
  return (["small", "medium", "large"] as const).filter(tier => new RegExp(`\\b${tier}\\b`).test(lower));
}

function searchCars({ priceMin, priceMax, seatsMin, bodyType, sizeTier, powertrain, excludeMostExpensive, excludeCheapest, sortBy, order, limit }: PriceSearch): VolvoCar[] {
  let cars = volvoUkModels
    .filter(car => (priceMin === undefined || car.price >= priceMin) && (priceMax === undefined || car.price <= priceMax))
    .filter(car => seatsMin === undefined || car.seats >= seatsMin)
    .filter(car => !bodyType || (bodyType === "suv" ? car.type.toLowerCase().includes("suv") : car.type.toLowerCase().includes(bodyType)))
    .filter(car => matchesSizeTier(car, sizeTier))
    .filter(car => !powertrain || (powertrain === "electric" ? car.type.includes("Electric") : powertrain === "plug_in_hybrid" ? car.type.includes("Plug-in") : car.type.includes("Mild hybrid")))
    .sort((a, b) => order === "asc" ? a.price - b.price : b.price - a.price);
  if (excludeMostExpensive && cars.length > 1) cars = cars.filter(car => car.id !== [...cars].sort((a, b) => b.price - a.price)[0].id);
  if (excludeCheapest && cars.length > 1) cars = cars.filter(car => car.id !== [...cars].sort((a, b) => a.price - b.price)[0].id);
  return cars.slice(0, Math.min(Math.max(limit, 1), 5));
}

function groundedDiscovery(message: string, powertrain: string | null) {
  const seats = explicitlyRequestedSeats(message);
  const bodyType = /\bsuv\b/.test(message) ? "suv" : /\bestate\b/.test(message) ? "estate" : /\bsaloon\b/.test(message) ? "saloon" : null;
  const pricePreference: "lowest" | "highest" | null = /\b(?:cheap|cheapest|affordable|lowest(?:[- ]priced)?)\b/.test(message) ? "lowest" : /\b(?:expensive|premium|top[- ]end|highest(?:[- ]priced)?|most expensive)\b/.test(message) ? "highest" : null;
  const hasDiscoveryLanguage = /\b(?:need|want|looking|find|show|recommend|car|vehicle|suv|estate|saloon|seat|seater|family|cheap|premium)\b/.test(message);
  // Leave relational price questions and comparisons to their dedicated
  // rules below: they need a reference model or a trade-off explanation.
  if (/\b(?:cheaper than|more expensive than|under|budget|compare|versus|difference)\b/.test(message)) return null;
  const groundedPowertrain = powertrain === "electric" || powertrain === "plug_in_hybrid" || powertrain === "mild_hybrid"
    ? powertrain
    : null;
  if (!hasDiscoveryLanguage || (!seats && !groundedPowertrain && !bodyType && !pricePreference)) return null;

  const matches = searchCars({
    seatsMin: seats ?? undefined,
    bodyType,
    powertrain: groundedPowertrain,
    sortBy: "price",
    order: pricePreference === "highest" ? "desc" : "asc",
    limit: 5,
  }).filter(car => !seats || car.seats === seats);
  return { seats, powertrain: groundedPowertrain, bodyType, pricePreference, matches };
}

function namedModelFor(message: string): VolvoCar | null {
  const lower = message.toLowerCase();
  return volvoUkModels.find(car => new RegExp(`\\b${car.id}\\b`, "i").test(lower)) || null;
}

function referenceComparisonFor(message: string, fallbackReference: VolvoCar | null = null): ReferenceComparison | null {
  const lower = message.toLowerCase();
  const reference = namedModelFor(message) || fallbackReference;
  if (!reference) return null;
  if (/\blittle\s+(bit\s+)?more expensive than\b/.test(lower)) {
    return { reference, relation: "little_more_expensive", search: { priceMin: reference.price, priceMax: Math.floor(reference.price * 1.15), sortBy: "price", order: "asc", limit: 3 } };
  }
  if (/\bcheaper than\b/.test(lower)) {
    return { reference, relation: "cheaper_than", search: { priceMax: reference.price, sortBy: "price", order: "desc", limit: 3 } };
  }
  return null;
}

function directModelLookupFor(message: string): VolvoCar | null {
  const lower = message.toLowerCase();
  const named = namedModelFor(message);
  if (!named) return null;
  // A bare model entry (“ex60”) is a deliberate model-selection action.
  if (new RegExp(`^\\s*${named.id}\\s*[.!?]?$`, "i").test(message)) return named;
  if (!/\b(show|open|select|choose|configure|build|look at)\b/.test(lower)) return null;
  return named;
}

function comparedModelsFor(message: string): VolvoCar[] {
  const lower = message.toLowerCase();
  return volvoUkModels.filter(car => new RegExp(`\\b${car.id}\\b`, "i").test(lower));
}

function normalizePowertrain(message: string) {
  const lower = message.toLowerCase();
  if (/\b(full electric|fully electric|electric only|all-electric|ev|electric)\b/.test(lower)) return "electric";
  if (/\b(mild[- ]hybrid|mhev)\b/.test(lower)) return "mild_hybrid";
  if (/\b(plug[- ]in hybrid|phev)\b/.test(lower)) return "plug_in_hybrid";
  if (/\bhybrid\b/.test(lower)) return "hybrid";
  return null;
}

// This intentionally corrects only a small, product-owned vocabulary. We do
// not use fuzzy matching to turn arbitrary customer text into a car choice.
function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previous = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }
  return row[right.length];
}

function normalizeCustomerMessage(input: string) {
  const commonTypos: Record<string, string> = {
    eletric: "electric",
    electic: "electric",
    hybdrid: "hybrid",
    sevn: "seven",
    seater: "seater",
    famly: "family",
    colur: "colour",
  };
  let message = input.trim().toLowerCase().replace(/[–—]/g, "-");
  message = message.replace(/\b(ex|xc|ec|es|v)\s*[- ]?\s*([3469])[oO]\b/g, "$1$20");
  message = message.replace(/\b(ex|xc|ec|es|v)\s*[- ]?\s*([3469])0\b/g, "$1$20");
  message = message.replace(/\b[a-z]+\b/g, (token) => commonTypos[token] || token);
  message = message.replace(/\b(?:ex|xc|ec|es|v)[a-z0-9-]{1,5}\b/g, (token) => {
    const matches = modelIds.filter(id => editDistance(token.replace(/-/g, ""), id) <= 1);
    return matches.length === 1 ? matches[0] : token;
  });
  return message;
}

function isGreeting(message: string) {
  return /^(?:hi+|hello+|hey+|heya|heyt|yo|good (?:morning|afternoon|evening))[!.\s]*$/.test(message);
}

function explicitlyRequestedSeats(message: string) {
  if (/\b(?:7|seven)\s*(?:seat|seater)s?\b/.test(message)) return 7;
  if (/\b(?:5|five)\s*(?:seat|seater)s?\b/.test(message)) return 5;
  return null;
}

const searchCarsTool = {
  type: "function",
  name: "search_cars",
  description: "Return Volvo Cars UK models ranked by indicative starting price, optionally filtered by seats, body type or powertrain. Exclusion flags remove the single highest- or lowest-priced candidate after filters are applied. Use this for any request to rank, compare, list the cheapest, lowest-priced or most expensive cars.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["priceMin", "priceMax", "seatsMin", "bodyType", "sizeTier", "powertrain", "excludeMostExpensive", "excludeCheapest", "sortBy", "order", "limit"],
    properties: {
      priceMin: { type: ["integer", "null"] },
      priceMax: { type: ["integer", "null"] },
      seatsMin: { type: ["integer", "null"], minimum: 2, maximum: 7 },
      bodyType: { type: ["string", "null"], enum: ["suv", "estate", "saloon", null] },
      sizeTier: { type: ["string", "null"], enum: ["small", "medium", "large", null] },
      powertrain: { type: ["string", "null"], enum: ["electric", "plug_in_hybrid", "mild_hybrid", null] },
      excludeMostExpensive: { type: "boolean" },
      excludeCheapest: { type: "boolean" },
      sortBy: { type: "string", enum: ["price"] },
      order: { type: "string", enum: ["asc", "desc"] },
      limit: { type: "integer", minimum: 1, maximum: 5 }
    }
  }
} as const;

const configureCarTool = {
  type: "function", name: "configure_car", strict: true,
  description: "Open a single Volvo Cars UK model in the configurator. Use when the customer names exactly one model without comparison intent, or chooses a model from a comparison.",
  parameters: { type: "object", additionalProperties: false, required: ["model"], properties: { model: { type: "string", enum: [...modelIds] } } }
} as const;

const compareCarsTool = {
  type: "function", name: "compare_cars", strict: true,
  description: "Compare two or more named Volvo Cars UK models. Returns price, seats, rangeMiles (WLTP combined), batteryKwh (nominal), and chargingSpeedKw (DC station power used for the published 10-80% charging time). Use these fields when the customer asks about range, battery or charging. Use for compare or difference requests before configuring a car.",
  parameters: { type: "object", additionalProperties: false, required: ["models"], properties: { models: { type: "array", minItems: 2, maxItems: 3, items: { type: "string", enum: [...modelIds] } } } }
} as const;

const getCarDetailsTool = {
  type: "function", name: "get_car_details", strict: true,
  description: "Return one Volvo Cars UK model's snapshot specifications and available prototype configuration choices. The return shape is { car, trims, colours, wheels, packages, options }, where each choice is { id, name, priceDelta }. Use this for questions about a single model's price, seats, range, battery, charging, trim, colour, wheels, packages or options without opening its configuration.",
  parameters: { type: "object", additionalProperties: false, required: ["model"], properties: { model: { type: "string", enum: [...modelIds] } } }
} as const;

const setFinancingTool = {
  type: "function", name: "set_financing", strict: true,
  description: "Set the finance preference for the active Volvo configuration. This stores a preference only; it must never produce a credit quote or eligibility decision.",
  parameters: { type: "object", additionalProperties: false, required: ["type", "downPaymentPercent", "termMonths"], properties: { type: { type: "string", enum: ["purchase", "pcp", "loan", "pch"] }, downPaymentPercent: { type: ["integer", "null"], minimum: 0, maximum: 100 }, termMonths: { type: ["integer", "null"], minimum: 12, maximum: 84 } } }
} as const;

function getCarDetails(model: VolvoCar) {
  const toChoice = ({ id, name, priceDelta }: { id: string; name: string; priceDelta: number }) => ({ id, name, priceDelta });
  return {
    car: model,
    trims: catalog.trims.map(toChoice),
    colours: catalog.colors.map(toChoice),
    wheels: catalog.wheels.map(toChoice),
    packages: catalog.options.filter(item => item.id.endsWith("-pack")).map(toChoice),
    options: catalog.options.filter(item => !item.id.endsWith("-pack")).map(toChoice)
  };
}

function modelDetailsPresentation(model: VolvoCar, question = "") {
  const details = getCarDetails(model);
  const trimSummary = details.trims.map(trim => `${trim.name}${trim.priceDelta ? ` (+£${trim.priceDelta.toLocaleString("en-GB")})` : " (included)"}`).join(", ");
  const list = (choices: Array<{ name: string; priceDelta: number }>) => choices.map(choice => `${choice.name}${choice.priceDelta ? ` (+£${choice.priceDelta.toLocaleString("en-GB")})` : ""}`).join(", ");
  const lower = question.toLowerCase();
  const focusedReply = /\bcolou?rs?|paint\b/.test(lower) ? `Available prototype exterior colours for ${model.name}: ${list(details.colours)}.`
    : /\bwheels?|rims?\b/.test(lower) ? `Available prototype wheels for ${model.name}: ${list(details.wheels)}.`
    : /\bpackages?\b/.test(lower) ? `Available prototype packages for ${model.name}: ${list(details.packages)}.`
    : /\boptions?\b/.test(lower) ? `Available prototype options for ${model.name}: ${list(details.options)}.`
    : /\btrims?\b/.test(lower) ? `Available prototype trims for ${model.name}: ${trimSummary}.`
    : null;
  return {
    details,
    assistantReply: focusedReply || `${model.name} is a ${model.type} with ${model.seats} seats, from £${model.price.toLocaleString("en-GB")}. Range: ${model.rangeMiles === null ? "spec unavailable" : `${model.rangeMiles} WLTP miles`}. Available prototype trims: ${trimSummary}. I also have the available colours, wheels, packages and options ready to explore.`
  };
}

function isModelDetailQuestion(message: string) {
  return /\b(range|mileage|miles|price|cost|charging|battery|seats?|passengers?|trims?|colou?rs?|wheels?|packages?|options?)\b/i.test(message);
}

type ConfigurationChanges = { trim?: string; color?: string; wheels?: string; addOptions?: string[]; removeOptions?: string[] };

function configurationChangesFor(message: string): ConfigurationChanges | null {
  const lower = message.toLowerCase();
  const remove = /\b(remove|without|delete|take off)\b/.test(lower);
  const changes: ConfigurationChanges = {};
  const trim = catalog.trims.find(item => lower.includes(item.id) || lower.includes(item.name.toLowerCase()));
  const color = catalog.colors.find(item => lower.includes(item.id) || lower.includes(item.name.toLowerCase()))
    || (/\bblack\b/.test(lower) ? catalog.colors.find(item => item.id === "onyx-black") : undefined)
    || (/\bwhite\b/.test(lower) ? catalog.colors.find(item => item.id === "crystal-white") : undefined)
    || (/\bgreen\b/.test(lower) ? catalog.colors.find(item => item.id === "sage-green") : undefined)
    || (/\bblue\b/.test(lower) ? catalog.colors.find(item => item.id === "fjord-blue") : undefined);
  const wheels = catalog.wheels.find(item => lower.includes(item.id) || lower.includes(item.name.toLowerCase()))
    || (/\b(?:bigger|large) wheels?\b|\b21[ -]?(?:inch|in) wheels?\b/.test(lower) ? catalog.wheels.find(item => item.id === "21-diamond-cut") : undefined)
    || (/\b20[ -]?(inch|in)\b/.test(lower) ? catalog.wheels.find(item => item.id === "20-turbine") : undefined);
  if (trim) changes.trim = trim.id;
  if (color) changes.color = color.id;
  if (wheels) {
    changes.wheels = wheels.id;
    if (wheels.requiresTrim?.length && !changes.trim) changes.trim = wheels.requiresTrim[0];
  }
  const matchedOptions = catalog.options.filter(item => lower.includes(item.id) || lower.includes(item.name.toLowerCase()));
  if (matchedOptions.length) {
    if (remove) changes.removeOptions = matchedOptions.map(item => item.id);
    else changes.addOptions = matchedOptions.map(item => item.id);
  }
  return Object.keys(changes).length ? changes : null;
}

function configurationChangeSummary(changes: ConfigurationChanges) {
  const labels = [changes.trim && find(catalog.trims, changes.trim)?.name, changes.color && find(catalog.colors, changes.color)?.name, changes.wheels && find(catalog.wheels, changes.wheels)?.name, ...(changes.addOptions || []).map(id => find(catalog.options, id)?.name), ...(changes.removeOptions || []).map(id => `remove ${find(catalog.options, id)?.name}`)].filter(Boolean);
  return labels.join(", ");
}

function buildReply(message: string, extracted: any, state: PreferenceState, rankedCars: VolvoCar[] = [], comparison: ReferenceComparison | null = null, isSessionStart = false) {
  const lower = message.toLowerCase();
  const currentLower = message.toLowerCase();
  if (extracted.intent === "greeting" && isSessionStart) return { assistantReply: "Hello. I can help you choose and configure a Volvo Cars UK vehicle. What matters most: passengers, driving, budget, or a must-have?", recommendations: [], clarificationQuestion: "" };
  if (extracted.intent === "greeting" || !extracted.relevant || extracted.intent === "clarify") return { assistantReply: "Could you rephrase that in terms of a Volvo Cars UK model, requirement, comparison, configuration choice or finance route?", recommendations: [], clarificationQuestion: "" };
  if (extracted.intent === "show_model" && state.model) {
    const selected = volvoUkModels.find(car => car.id === state.model);
    if (selected) return { assistantReply: `${selected.name} is a Volvo UK ${selected.type} with ${selected.seats} seats, from £${selected.price.toLocaleString("en-GB")} in this snapshot.`, recommendations: [selected], clarificationQuestion: "Would you like to configure its colour, wheels, or finance route?" };
  }
  // A newly stated seat count replaces earlier conversation context. For
  // example, “let’s try 5 seats” must clear a previous 7-seat requirement.
  const explicitSeats = currentLower.match(/\b(5|7|five|seven)\s*seats?\b/);
  const requestedSeats = explicitSeats
    ? (explicitSeats[1] === "7" || explicitSeats[1] === "seven" ? 7 : 5)
    : state.seats;
  const wantsSeven = (requestedSeats ?? 0) >= 7;
  const wantsElectric = state.powertrain === "electric";
  const wantsPlug = state.powertrain === "plug_in_hybrid";
  const cheaperThanEx60 = /cheaper|lower price|less expensive/.test(lower) && /ex60/.test(lower);
  const compareLowest = /\b(compare|show|list)\b.{0,30}\b(lowest|cheapest|lower price)\b|\b(lowest-priced|cheapest options?)\b/.test(message.toLowerCase());
  const wantsExpensive = /\b(expensive|premium|highest[- ]priced|most expensive)\b/.test(currentLower);
  const budget = state.budgetGbp || 0;
  let candidates = volvoUkModels.filter(car => !wantsSeven || car.seats >= 7);
  if (wantsElectric) candidates = candidates.filter(car => car.type.includes("Electric"));
  if (wantsPlug) candidates = candidates.filter(car => car.type.includes("Plug-in"));
  if (cheaperThanEx60) candidates = candidates.filter(car => car.price < 56860);
  candidates = candidates.sort((a, b) => (budget ? Math.abs(a.price - budget) - Math.abs(b.price - budget) : a.price - b.price)).slice(0, 3);
  if (!candidates.length) return { assistantReply: "I can’t find a Volvo UK model that meets every stated requirement in this snapshot.", recommendations: [], clarificationQuestion: "Which matters more: seat count, powertrain, or budget?" };
  const best = candidates[0];
  if (comparison && rankedCars.length) {
    const options = rankedCars.filter(car => car.id !== comparison.reference.id);
    const recommended = options[0];
    if (!recommended) return { assistantReply: `I could not find another Volvo UK model in the requested range around ${comparison.reference.name}.`, recommendations: [], clarificationQuestion: "Would you like to widen the price range?" };
    const direction = comparison.relation === "little_more_expensive"
      ? `within 15% above ${comparison.reference.name}'s £${comparison.reference.price.toLocaleString("en-GB")} starting price`
      : `below ${comparison.reference.name}'s £${comparison.reference.price.toLocaleString("en-GB")} starting price`;
    return { assistantReply: `${recommended.name} is the closest match: ${recommended.type}, ${recommended.seats} seats, from £${recommended.price.toLocaleString("en-GB")}, ${direction}.`, recommendations: options, clarificationQuestion: "Would you like to compare its configuration with the reference model?" };
  }
  if (compareLowest) {
    const ranked = rankedCars.length ? rankedCars : candidates;
    const lowest = ranked[0];
    const comparison = ranked.map(car => `${car.name} (${car.type}, ${car.seats} seats) from £${car.price.toLocaleString("en-GB")}`).join("; ");
    return { assistantReply: `Here are the lowest-priced Volvo UK options: ${comparison}. ${lowest.name} is the lowest-priced starting point in this comparison.`, recommendations: ranked, clarificationQuestion: "Would you like to explore that build, or should I narrow this by electric, size, or budget?" };
  }
  if ((wantsExpensive || state.pricePreference === "highest") && rankedCars.length) {
    const premium = rankedCars[0];
    return { assistantReply: `${premium.name} is the highest-priced Volvo UK starting point in this snapshot: ${premium.type}, ${premium.seats} seats, from £${premium.price.toLocaleString("en-GB")}.`, recommendations: rankedCars, clarificationQuestion: "Would you like to explore its configuration, or compare it with another premium Volvo?" };
  }
  const clarificationQuestion = !budget ? "Do you have a comfortable budget range in GBP, or should I compare the lowest-priced suitable options?" : "";
  return { assistantReply: `${best.name} is the best current Volvo UK starting point: ${best.type}, ${best.seats} seats, from £${best.price.toLocaleString("en-GB")}. ${cheaperThanEx60 ? "It is priced below the EX60." : ""}`, recommendations: candidates, clarificationQuestion };
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "relevant", "confidence", "clarificationNeeded", "preferences", "changes", "summary"],
  properties: {
    intent: { type: "string", enum: ["greeting", "answer", "change_requirement", "compare", "show_model", "choose_model", "irrelevant", "clarify"] },
    relevant: { type: "boolean" },
    confidence: { type: "number" },
    clarificationNeeded: { type: "boolean" },
    preferences: {
      type: "object",
      additionalProperties: false,
      required: ["seats", "budgetGbp", "powertrain", "colour", "driving", "charging", "model"],
      properties: {
        seats: { type: ["integer", "null"] },
        budgetGbp: { type: ["integer", "null"] },
        powertrain: { type: ["string", "null"], enum: ["electric", "plug_in_hybrid", "mild_hybrid", "open", null] },
        colour: { type: ["string", "null"] },
        driving: { type: ["string", "null"] },
        charging: { type: ["string", "null"], enum: ["home_or_work", "could_install", "public", "uncertain", null] },
        model: { type: ["string", "null"], enum: [...modelIds, null] }
      }
    },
    changes: {
      type: "object",
      additionalProperties: false,
      required: ["seats", "budgetGbp", "powertrain", "colour", "driving", "charging", "model", "pricePreference"],
      properties: {
        seats: { type: ["integer", "null"] },
        budgetGbp: { type: ["integer", "null"] },
        powertrain: { type: ["string", "null"], enum: ["electric", "plug_in_hybrid", "mild_hybrid", "open", null] },
        colour: { type: ["string", "null"] },
        driving: { type: ["string", "null"] },
        charging: { type: ["string", "null"], enum: ["home_or_work", "could_install", "public", "uncertain", null] },
        model: { type: ["string", "null"], enum: [...modelIds, null] },
        pricePreference: { type: ["string", "null"], enum: ["lowest", "highest", null] }
      }
    },
    summary: { type: "string" }
  }
} as const;

export async function POST(request: Request) {
  const key = process.env.OPENAI_API_KEY;
  const body = await request.json().catch(() => null);
  const rawMessage = typeof body?.message === "string" ? body.message.trim() : "";
  const message = normalizeCustomerMessage(rawMessage);
  const sessionId = typeof body?.sessionId === "string" && body.sessionId.length <= 100 ? body.sessionId : "default";
  const isSessionStart = !sessions.has(sessionId);
  const sessionState = sessions.get(sessionId) ?? emptySession();
  sessions.set(sessionId, sessionState);
  const profile = body?.profile && typeof body.profile === "object" ? body.profile : {};
  const savedState = profile && typeof profile === "object" && "preferenceState" in profile && typeof (profile as { preferenceState?: unknown }).preferenceState === "object"
    ? { ...emptyPreferenceState, ...((profile as { preferenceState: Partial<PreferenceState> }).preferenceState) }
    : emptyPreferenceState;
  if (!message || message.length > 1000) return NextResponse.json({ error: "Send a message of up to 1,000 characters." }, { status: 400 });
  const normalizedPowertrain = normalizePowertrain(message);

  // Greetings and high-confidence catalogue searches should remain helpful
  // even when an AI provider is unavailable. Neither changes preferences.
  if (isGreeting(message)) {
    return NextResponse.json({
      intent: "greeting", relevant: true, confidence: 1, clarificationNeeded: false,
      preferences: emptyPreferenceState, changes: emptyPreferenceState,
      summary: "Customer greeted.", preferenceState: savedState, sessionState,
      assistantReply: isSessionStart
        ? "Hello. I can help you choose and configure a Volvo Cars UK vehicle. What matters most: passengers, driving, budget, or a must-have?"
        : "Hello again. I’ve kept your current Volvo preferences in mind. What would you like to explore or change?",
      resolvedBy: "local_greeting",
    });
  }

  if (/^(?:undo|undo that|go back)[!.\s]*$/.test(message)) {
    return NextResponse.json({ intent: "undo", relevant: true, confidence: 1, clarificationNeeded: false, preferences: emptyPreferenceState, changes: emptyPreferenceState, summary: "Customer requested an undo.", preferenceState: savedState, sessionState, assistantReply: "I’ve undone the most recent configuration change.", resolvedBy: "local_session_command" });
  }
  if (/^(?:start over|reset|reset build|clear my build)[!.\s]*$/.test(message)) {
    const resetState = emptySession();
    sessions.set(sessionId, resetState);
    return NextResponse.json({ intent: "reset", relevant: true, confidence: 1, clarificationNeeded: false, preferences: emptyPreferenceState, changes: emptyPreferenceState, summary: "Customer reset the build.", preferenceState: emptyPreferenceState, sessionState: resetState, assistantReply: "I’ve reset the build and the saved conversation preferences. What would you like in your Volvo?", resolvedBy: "local_session_command" });
  }
  if (/^(?:i )?(?:need|want|am looking for) (?:a )?(?:car|volvo)[!.\s]*$/.test(message)) {
    return NextResponse.json({ intent: "clarify", relevant: true, confidence: 1, clarificationNeeded: true, preferences: emptyPreferenceState, changes: emptyPreferenceState, summary: "Customer started vehicle discovery.", preferenceState: savedState, sessionState, assistantReply: "Absolutely. What matters most for your Volvo: passengers, electric driving, budget, or a particular body style?", resolvedBy: "local_discovery_prompt" });
  }

  const discovery = groundedDiscovery(message, normalizedPowertrain);
  if (discovery) {
    sessionState.lastResults = discovery.matches;
    sessionState.activeComparison = [];
    const powertrainLabel = discovery.powertrain === "electric" ? "electric " : discovery.powertrain === "plug_in_hybrid" ? "plug-in hybrid " : discovery.powertrain === "mild_hybrid" ? "mild-hybrid " : "";
    const seatLabel = discovery.seats ? `${discovery.seats}-seat ` : "";
    const bodyLabel = discovery.bodyType ? `${discovery.bodyType.toUpperCase()} ` : "";
    const priceLabel = discovery.pricePreference === "lowest" ? "lowest-priced " : discovery.pricePreference === "highest" ? "highest-priced " : "";
    const changes = { ...emptyPreferenceState, seats: discovery.seats, powertrain: discovery.powertrain, pricePreference: discovery.pricePreference };
    const preferenceState = mergePreferenceState(savedState, changes);
    if (!discovery.matches.length) {
      return NextResponse.json({ intent: "clarify", relevant: true, confidence: 1, clarificationNeeded: true, preferences: changes, changes, summary: "No exact catalogue match.", preferenceState, sessionState, assistantReply: `I couldn’t find a ${priceLabel}${seatLabel}${powertrainLabel}${bodyLabel}Volvo UK match in this catalogue snapshot. Which requirement would you like to relax?`, resolvedBy: "local_catalogue_search" });
    }
    const listed = discovery.matches.map(car => `${car.name} from £${car.price.toLocaleString("en-GB")}`).join("; ");
    return NextResponse.json({ intent: "search", relevant: true, confidence: 1, clarificationNeeded: false, preferences: changes, changes, summary: "Resolved from explicit customer requirements.", preferenceState, sessionState, assistantReply: `I found these ${priceLabel}${seatLabel}${powertrainLabel}${bodyLabel}Volvo UK options: ${listed}. Would you like to compare them or open one to configure?`, recommendations: discovery.matches, toolUsed: "search_cars", resolvedBy: "local_catalogue_search" });
  }

  const referenceMessage = message.toLowerCase();
  const asksToConfigureCheapest = /\b(?:pick|choose|select|configure|build|take)\b.*\b(?:the )?(?:cheapest|lowest(?:[- ]priced)?|most affordable)\b/i.test(message);
  if (asksToConfigureCheapest) {
    // Prefer the customer's current shortlist or comparison. Only fall back
    // to the full catalogue when they have not yet explored any models.
    const source = sessionState.activeComparison.length
      ? sessionState.activeComparison
      : sessionState.lastResults.length
        ? sessionState.lastResults
        : volvoUkModels;
    const selected = [...source].sort((left, right) => left.price - right.price)[0];
    if (selected) {
      sessionState.activeConfig = selected.id;
      sessionState.activeComparison = [];
      sessionState.lastResults = [selected];
      const changes = { ...emptyPreferenceState, model: selected.id, pricePreference: "lowest" as const };
      const preferenceState = mergePreferenceState(savedState, changes);
      return NextResponse.json({
        intent: "show_model", relevant: true, confidence: 1, clarificationNeeded: false,
        preferences: changes, changes, summary: `Configured the lowest-priced model: ${selected.name}.`,
        preferenceState, sessionState,
        assistantReply: `I’ve selected the lowest-priced ${source === volvoUkModels ? "Volvo UK starting point" : "option from your shortlist"}: ${selected.name}, from £${selected.price.toLocaleString("en-GB")}. It is now open in the configurator.`,
        recommendations: [selected], toolUsed: "configure_car", resolvedBy: "local_lowest_price_selection",
      });
    }
  }
  const comparisonAttribute = comparisonAttributeFor(message);
  const isComparativeQuestion = /\b(which|better|best|compare|difference|versus|vs\.?)\b/i.test(message);
  const hasAutomaticShortlistCriteria = /\b(two|2|cheap|cheapest|affordable|lowest|expensive|premium|highest|electric|hybrid|small|medium|large|suv|estate|saloon|seats?)\b/i.test(message);
  const explicitlyNamedComparison = comparedModelsFor(message).length >= 2;
  // “Compare two expensive electric cars” is a fresh catalogue search. In
  // contrast, “which of the two is more expensive?” is a question about the
  // already active comparison.
  const requestsFreshComparison = /\bcompare\b/i.test(message) && hasAutomaticShortlistCriteria;
  const comparisonSource = sessionState.activeComparison.length
    ? sessionState.activeComparison
    : sessionState.lastResults.length >= 2 ? sessionState.lastResults : [];
  const trimRangeModel = namedModelFor(message);
  if (trimRangeModel && /\btrims?\b/i.test(message) && /\b(range|mileage|miles)\b/i.test(message)) {
    const trims = getCarDetails(trimRangeModel).trims.map(trim => trim.name).join(", ");
    return NextResponse.json({ intent: "clarify", relevant: true, confidence: 1, clarificationNeeded: false, summary: "Trim-level range is not available in the prototype catalogue.", assistantReply: `I can’t verify which ${trimRangeModel.name} trim has the most range from this snapshot. Its published model-level range is ${trimRangeModel.rangeMiles === null ? "unavailable" : `${trimRangeModel.rangeMiles} WLTP miles`}, but trim-specific range figures are not stored. Available prototype trims are ${trims}. A production configurator should retrieve a validated range after trim, wheel and option selection.`, recommendations: [trimRangeModel], preferenceState: savedState, sessionState, resolvedBy: "model_level_range_only" });
  }
  if (/^\s*(?:seat count|seats?)\s*[.!?]?\s*$/i.test(message)) {
    const sevenSeatCars = volvoUkModels.filter(car => car.seats >= 7).sort((a, b) => a.price - b.price);
    return NextResponse.json({ intent: "clarify", relevant: true, confidence: 1, clarificationNeeded: true, summary: "Customer prioritised seat count.", assistantReply: `Prioritising seven seats means the available Volvo UK starting points are ${sevenSeatCars.map(car => `${car.name} from £${car.price.toLocaleString("en-GB")}`).join(" and ")}. None is priced below the EX60 starting price, so the next choice is whether to accept a higher budget or reduce the seat requirement.`, clarificationQuestion: "Would you rather keep seven seats or stay below the EX60 price?", recommendations: sevenSeatCars, preferenceState: { ...savedState, seats: 7 }, sessionState, resolvedBy: "clarification_priority" });
  }
  if (comparisonAttribute && isComparativeQuestion && comparisonSource.length >= 2 && !requestsFreshComparison) {
    const sorted = [...comparisonSource].sort((left, right) => {
      const leftValue = comparisonValue(left, comparisonAttribute.key);
      const rightValue = comparisonValue(right, comparisonAttribute.key);
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      return comparisonAttribute.direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
    });
    const winner = sorted.find(car => comparisonValue(car, comparisonAttribute.key) !== null);
    if (winner) {
      const table = sorted.map(car => ({ model: car.name, attribute: comparisonAttribute.label, value: formatComparisonValue(car, comparisonAttribute.key) }));
      const tableText = table.map(row => `${row.model} | ${row.value}`).join("\n");
      return NextResponse.json({ intent: "compare", relevant: true, confidence: 1, clarificationNeeded: false, summary: "Resolved from stored comparison state.", assistantReply: `${winner.name} has ${comparisonAttribute.winnerDescription}: ${formatComparisonValue(winner, comparisonAttribute.key)}.\n\n${comparisonAttribute.label}\n${tableText}`, recommendations: sorted, preferenceState: savedState, sessionState, comparisonTable: table, resolvedBy: "local_session_attribute" });
    }
  }
  if (comparisonAttribute && isComparativeQuestion && comparisonSource.length < 2 && !hasAutomaticShortlistCriteria && !explicitlyNamedComparison) {
    return NextResponse.json({ intent: "clarify", relevant: true, confidence: 1, clarificationNeeded: true, summary: "A comparison needs at least two saved models.", assistantReply: "I need two Volvo models to compare. Which model would you like to compare with the current one?", recommendations: [], preferenceState: savedState, sessionState, resolvedBy: "local_clarify" });
  }
  const configurationChanges = configurationChangesFor(message);
  if (!configurationChanges && /\bmake (?:it )?bigger\b/i.test(message) && !/\b(?:car|suv|wheels?|rims?|trim)\b/i.test(message)) {
    return NextResponse.json({ intent: "clarify", relevant: true, confidence: 1, clarificationNeeded: true, summary: "The requested size change is ambiguous.", assistantReply: "Do you mean larger wheels, or would you like to search for a larger Volvo?", recommendations: [], preferenceState: savedState, sessionState, resolvedBy: "local_clarify" });
  }
  if (configurationChanges?.wheels && !sessionState.activeConfig && !/\b(the cheaper one|the pricier one|the expensive one|second one|that one)\b/i.test(message)) {
    return NextResponse.json({ intent: "clarify", relevant: true, confidence: 1, clarificationNeeded: true, summary: "Wheel changes need an active configuration.", assistantReply: "Which Volvo would you like to configure before changing its wheels?", recommendations: [], preferenceState: savedState, sessionState, resolvedBy: "local_clarify" });
  }
  if (/\b(the two|of those|the other one|second one|the (?:expensive|cheaper|pricier) one|either|both|that one)\b/.test(referenceMessage) && (sessionState.activeComparison.length || sessionState.lastResults.length)) {
    const source = sessionState.activeComparison.length ? sessionState.activeComparison : sessionState.lastResults;
    const selected = /second one|other one/.test(referenceMessage) ? source[1] : /cheaper/.test(referenceMessage) ? [...source].sort((a,b)=>a.price-b.price)[0] : /expensive|pricier/.test(referenceMessage) ? [...source].sort((a,b)=>b.price-a.price)[0] : /better range/.test(referenceMessage) ? [...source].sort((a,b)=>(b.rangeMiles ?? -1)-(a.rangeMiles ?? -1))[0] : source[0];
    if (selected) {
      const shouldConfigure = /\b(configure|build|take|choose|select)\b/.test(referenceMessage) || Boolean(configurationChanges);
      if (shouldConfigure) sessionState.activeConfig = selected.id;
      const changes = shouldConfigure ? { ...emptyPreferenceState, model: selected.id } : emptyPreferenceState;
      const preferenceState = mergePreferenceState(savedState, changes);
      return NextResponse.json({ intent: shouldConfigure ? "show_model" : "select_from_session", relevant:true, confidence:1, clarificationNeeded:false, changes, summary:"Resolved from stored session state.", assistantReply:`${selected.name} is the selected result: from £${selected.price.toLocaleString("en-GB")}${selected.rangeMiles === null ? "; range spec unavailable." : `; up to ${selected.rangeMiles} WLTP miles.`}${configurationChanges ? ` I’ve also updated: ${configurationChangeSummary(configurationChanges)}.` : ""}`, recommendations:[selected], preferenceState, sessionState, configurationChanges, toolUsed: shouldConfigure ? "configure_car" : undefined, resolvedBy:"local_session" });
    }
  }

  if (/\b(next step|take me to (?:the )?next step|continue(?: to)? (?:finance|delivery)?|proceed to (?:finance|delivery|checkout))\b/i.test(message)) {
    return NextResponse.json({ intent: "next_step", relevant: true, confidence: 1, clarificationNeeded: false, preferences: emptyPreferenceState, changes: emptyPreferenceState, summary: "Customer continued to the retailer-handoff journey.", preferenceState: savedState, sessionState, assistantReply: "Taking you to the next step: finance route, part exchange, delivery preference and retailer contact. No order or finance application will be submitted in this prototype.", resolvedBy: "next_step" });
  }

  if (configurationChanges) {
    return NextResponse.json({ intent: "change_configuration", relevant: true, confidence: 1, clarificationNeeded: false, preferences: emptyPreferenceState, changes: emptyPreferenceState, summary: `Customer changed ${configurationChangeSummary(configurationChanges)}.`, assistantReply: `I’ve updated the build: ${configurationChangeSummary(configurationChanges)}.`, preferenceState: savedState, sessionState, configurationChanges, resolvedBy: "local_configuration" });
  }

  // A question that names no model must not fall back to an arbitrary catalogue
  // default when the customer already has a car open in the configurator.
  const namedModel = namedModelFor(message);
  const activeConfigModel = !namedModel && sessionState.activeConfig
    ? volvoUkModels.find(car => car.id === sessionState.activeConfig) || null
    : null;
  if (activeConfigModel && /\b(show|open|configure|select|choose)\b.*\b(it|this|that|current(?: one| car)?)\b|\bwhat(?:'s| is) (?:the )?(?:current )?(?:car|model)\b/i.test(message)) {
    const changes = { ...emptyPreferenceState, model: activeConfigModel.id };
    const preferenceState = mergePreferenceState(savedState, changes);
    return NextResponse.json({ intent: "show_model", relevant: true, confidence: 1, clarificationNeeded: false, preferences: changes, changes, summary: `Resolved against the active ${activeConfigModel.name} configuration.`, preferenceState, sessionState, assistantReply: `${activeConfigModel.name} is the Volvo currently being configured.`, recommendations: [activeConfigModel], toolUsed: "configure_car", resolvedBy: "active_config" });
  }
  if (activeConfigModel && isModelDetailQuestion(message)) {
    const presentation = modelDetailsPresentation(activeConfigModel, message);
    sessionState.lastResults = [activeConfigModel];
    return NextResponse.json({ intent: "show_model", relevant: true, confidence: 1, clarificationNeeded: false, preferences: emptyPreferenceState, changes: emptyPreferenceState, summary: `Resolved against the active ${activeConfigModel.name} configuration.`, preferenceState: savedState, sessionState, assistantReply: presentation.assistantReply, recommendations: [activeConfigModel], toolUsed: "get_car_details", details: presentation.details, resolvedBy: "active_config" });
  }

  const comparedModels = comparedModelsFor(message);
  const comparisonIntent = comparedModels.length >= 2 || /\b(compare|difference between|versus|vs\.? )\b/.test(message.toLowerCase());
  if (comparisonIntent && comparedModels.length >= 2) {
    sessionState.activeComparison = comparedModels;
    sessionState.lastResults = comparedModels;
    const summary = comparedModels.map(car => `${car.name}: ${car.type}, ${car.seats} seats, from £${car.price.toLocaleString("en-GB")}`).join("; ");
    const specLine = (car: VolvoCar) => `${car.name}: range ${car.rangeMiles === null ? "spec unavailable" : `up to ${car.rangeMiles} WLTP miles`}; battery ${car.batteryKwh === null ? "spec unavailable" : `${car.batteryKwh} kWh`}; DC charging ${car.chargingSpeedKw === null ? "spec unavailable" : `${car.chargingSpeedKw} kW`}`;
    const specsDiffer = new Set(comparedModels.map(car => `${car.rangeMiles}|${car.chargingSpeedKw}`)).size > 1;
    const specificationSummary = specsDiffer ? ` Range and charging: ${comparedModels.map(specLine).join("; ")}.` : "";
    const extracted = { intent: "compare", relevant: true, confidence: 1, clarificationNeeded: false, preferences: { seats: null, budgetGbp: null, powertrain: null, colour: null, driving: null, charging: null, model: null }, changes: { seats: null, budgetGbp: null, powertrain: null, colour: null, driving: null, charging: null, model: null, pricePreference: null }, summary: "Customer requested a Volvo comparison." };
    return NextResponse.json({ ...extracted, preferenceState: savedState, sessionState, assistantReply: `Here is the Volvo UK comparison: ${summary}.${specificationSummary}`, recommendations: comparedModels, clarificationQuestion: "Which one would you like to configure?", toolUsed: "compare_cars", activeComparison: comparedModels.map(car => car.id) });
  }

  if (comparisonIntent && comparedModels.length === 0) {
    const requestedSizeTiers = requestedSizeTiersFor(message);
    if (requestedSizeTiers.length >= 2) {
      const representatives = requestedSizeTiers.map(tier => volvoUkModels
        .filter(car => matchesSizeTier(car, tier))
        .filter(car => !/\bsuv\b/i.test(message) || car.type.includes("SUV"))
        .filter(car => normalizedPowertrain !== "electric" || car.type.includes("Electric"))
        .sort((a, b) => a.price - b.price)[0])
        .filter((car): car is VolvoCar => Boolean(car));
      if (representatives.length >= 2) {
        sessionState.lastResults = representatives;
        sessionState.activeComparison = representatives;
        const summary = representatives.map(car => `${car.name}: ${car.type}, ${car.seats} seats, from £${car.price.toLocaleString("en-GB")}`).join("; ");
        return NextResponse.json({ intent: "compare", relevant: true, confidence: 1, clarificationNeeded: false, preferences: emptyPreferenceState, changes: emptyPreferenceState, summary: "Customer requested a mixed size-tier comparison.", preferenceState: savedState, sessionState, assistantReply: `I compared the lowest-priced ${requestedSizeTiers.join(" and ")} Volvo starting points: ${summary}.`, clarificationQuestion: "Would you like to configure either one, or narrow this by powertrain?", recommendations: representatives, toolUsed: "search_cars → compare_cars", activeComparison: representatives.map(car => car.id) });
      }
    }
    // “Compare the two cheapest” follows the previous shortlist, rather than
    // silently re-running a catalogue-wide search.
    let shortlist = sessionState.lastResults.length && /\b(two|2)\b.*\bcheapest|\bcheapest\b/i.test(message)
      ? [...sessionState.lastResults]
      : [...volvoUkModels];
    if (normalizedPowertrain === "electric") shortlist = shortlist.filter(car => car.type.includes("Electric"));
    if (normalizedPowertrain === "mild_hybrid") shortlist = shortlist.filter(car => car.type.includes("Mild hybrid"));
    if (normalizedPowertrain === "plug_in_hybrid") shortlist = shortlist.filter(car => car.type.includes("Plug-in"));
    const requestedSizeTier = /\b(?:large|big|seven[ -]?seat|7[ -]?seat)\b.*\b(?:suv|car)s?\b/i.test(message) ? "large" : /\b(?:small|compact)\b.*\b(?:suv|car)s?\b/i.test(message) ? "small" : /\bmedium\b.*\b(?:suv|car)s?\b/i.test(message) ? "medium" : null;
    if (requestedSizeTier) shortlist = shortlist.filter(car => matchesSizeTier(car, requestedSizeTier));
    if (/\bsuv\b/i.test(message)) shortlist = shortlist.filter(car => car.type.includes("SUV"));
    const cheap = /\b(cheap|cheapest|affordable|lowest)\b/.test(message.toLowerCase());
    shortlist = shortlist.sort((a,b)=>cheap ? a.price-b.price : b.price-a.price).slice(0, 2);
    if (shortlist.length >= 2) {
      sessionState.lastResults = shortlist; sessionState.activeComparison = shortlist;
      const summary = shortlist.map(car => `${car.name}: ${car.type}, ${car.seats} seats, from £${car.price.toLocaleString("en-GB")}`).join("; ");
      return NextResponse.json({ intent:"compare", relevant:true, confidence:1, clarificationNeeded:false, preferences:{seats:null,budgetGbp:null,powertrain:normalizedPowertrain,colour:null,driving:null,charging:null,model:null}, changes:{seats:null,budgetGbp:null,powertrain:normalizedPowertrain,colour:null,driving:null,charging:null,model:null,pricePreference:cheap?"lowest":null}, summary:"Customer requested an automatic shortlist comparison.", preferenceState:savedState, sessionState, assistantReply:`I shortlisted and compared: ${summary}.`, clarificationQuestion:"Which one would you like to configure?", recommendations:shortlist, toolUsed:"search_cars → compare_cars", activeComparison:shortlist.map(car=>car.id) });
    }
    if (requestedSizeTier || normalizedPowertrain) {
      const onlyMatch = shortlist[0];
      const alternative = normalizedPowertrain === "electric" && requestedSizeTier === "medium" ? "I can compare it with the smaller EX40 or the larger ES90 — which direction would be more useful?" : "Which requirement would you be happiest to relax: size, powertrain, or body style?";
      return NextResponse.json({ intent:"clarify", relevant:true, confidence:1, clarificationNeeded:true, preferences:emptyPreferenceState, changes:emptyPreferenceState, summary:"Not enough matching Volvo models to compare.", preferenceState:savedState, sessionState, assistantReply:onlyMatch?`I found one exact match: ${onlyMatch.name}, ${onlyMatch.type}, from £${onlyMatch.price.toLocaleString("en-GB")}. A second medium electric Volvo is not available in this snapshot. ${alternative}`:`I couldn’t find two Volvo UK models matching those exact criteria. ${alternative}`, clarificationQuestion:null, recommendations:shortlist, toolUsed:"search_cars" });
    }
  }

  // A direct catalogue ID is not an LLM judgment call. Resolve it before the
  // generic recommendation flow so “show EX40” can never become XC40.
  const directModel = directModelLookupFor(message);
  if (directModel) {
    sessionState.activeConfig = directModel.id; sessionState.activeComparison = [];
    const extracted = {
      intent: "show_model",
      relevant: true,
      confidence: 1,
      clarificationNeeded: false,
      preferences: { seats: null, budgetGbp: null, powertrain: null, colour: null, driving: null, charging: null, model: directModel.id },
      changes: { seats: null, budgetGbp: null, powertrain: null, colour: null, driving: null, charging: null, model: directModel.id, pricePreference: null },
      summary: `Customer requested ${directModel.name}.`
    };
    const preferenceState = mergePreferenceState(savedState, extracted.changes);
    return NextResponse.json({ ...extracted, preferenceState, sessionState, ...buildReply(message, extracted, preferenceState), toolUsed: "configure_car", resolvedBy: "catalogue_id" });
  }

  const comparison = referenceComparisonFor(message, activeConfigModel);
  const rankingQuestion = Boolean(comparison) || /\b(compare|show|list|rank)\b.{0,35}\b(lowest|cheapest|lowest-priced|most expensive|highest price)\b|\b(lowest-priced|cheapest options?|expensive|premium|highest[- ]priced|most expensive)\b/.test(message.toLowerCase());
  if (!key) {
    console.error("OpenAI interpretation request skipped: OPENAI_API_KEY is not configured.");
    return NextResponse.json({
      intent: "clarify", relevant: false, confidence: 0, clarificationNeeded: true,
      preferences: emptyPreferenceState, changes: emptyPreferenceState,
      summary: "The AI interpretation service is not configured.", preferenceState: savedState, sessionState,
      assistantReply: "I understood this may need a more open-ended interpretation, but the AI service is not configured right now. Please try a Volvo model, seats, powertrain, price, colour, wheels, package or finance request.",
    }, { status: 503 });
  }
  const apiRequest = (payload: unknown) => fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(payload)
  });
  const requestPayload = {
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      store: false,
      instructions: "You are the intent-extraction layer inside the Volvo Cars UK configurator. Your scope is limited to Volvo Cars UK vehicles, the customer's current Volvo build, compatible configuration choices, Volvo UK finance routes, home-charging support and retailer handoff. Treat questions about other car brands, unrelated topics, general web requests or unsupported commercial promises as irrelevant. Never invent a price, finance result, availability, specification, configuration compatibility, delivery date, charging installation outcome or retailer outcome. The available Volvo UK model families are EX30, EX40, EX60, EX90, EC40, ES90, XC40, XC60, XC90 and V60. Capture only explicit customer preferences. A greeting or irrelevant statement is not an answer to the current question. In changes, provide only values explicitly stated or clearly paraphrased in the latest customer message; use null for every unchanged field. Examples: cheap/affordable/lowest price = pricePreference lowest; expensive/premium/highest-priced = pricePreference highest; seven seater/room for grandparents = seats 7; no reliable home charging = charging public or uncertain; “let’s try five seats” = seats 5 and overrides an earlier seat count. Disambiguation: large SUV and big car are vehicle-search terms; bigger wheels and large rims are configuration terms only when an active configuration exists; standalone “make it bigger” requires one clarifying question. Powertrain normalisation: full electric, fully electric, EV, electric only and all-electric all mean electric; mild-hybrid and MHEV mean mild_hybrid; plug-in hybrid and PHEV mean plug_in_hybrid. Two-step example: compare two fully electric cars which are cheap -> search_cars with electric, price ascending and limit 2, then compare_cars using the returned IDs. Direct model lookup examples: customer “show ex40” => intent show_model and changes.model ex40; customer “tell me about XC90” => call get_car_details. Do not use compare for a direct model lookup. Use at most one external tool call per turn. Local session-state resolution needs no tool call. For two or more named models, or compare and difference requests, call compare_cars and do not configure a car. When comparing, include range, battery and DC charging in the customer-facing comparison whenever the returned models differ meaningfully on range or charging. For exactly one named model with no comparison intent, call configure_car. Call get_car_details for a single-model specification or trim question. Call search_cars for every price comparison. For “a little more expensive than [model]”, look up that model and search from its price to 15% above it, ascending. For “cheaper than [model]”, search up to that model's price, descending. Do not ask for a budget instead of using search_cars. Return only the requested structured output after any tool call.",
      input: `Session state: ${stateSummary(sessionState)}\nCurrent customer profile: ${JSON.stringify(profile)}\nCustomer message: ${message}\nNormalized powertrain: ${normalizedPowertrain ?? "null"}`,
      tools: [searchCarsTool, compareCarsTool, configureCarTool, getCarDetailsTool, setFinancingTool],
      tool_choice: rankingQuestion ? { type: "function", name: "search_cars" } : "required",
      parallel_tool_calls: false,
      text: { format: { type: "json_schema", name: "car_configurator_interpretation", strict: true, schema } }
    };
  let response = await apiRequest(requestPayload);
  if (!response.ok) {
    const providerError = await response.json().catch(() => ({}));
    const message = typeof providerError?.error?.message === "string" ? providerError.error.message : "Unknown OpenAI API error.";
    const code = typeof providerError?.error?.code === "string" ? providerError.error.code : "no_code";
    console.error("OpenAI interpretation request failed", { status: response.status, code, message });
    console.error(providerError);
    return NextResponse.json({ intent: "clarify", relevant: false, confidence: 0, clarificationNeeded: true, preferences: emptyPreferenceState, changes: emptyPreferenceState, summary: "The AI interpretation service is temporarily unavailable.", preferenceState: savedState, sessionState, assistantReply: "I couldn’t interpret that request right now. Please try again, or use a specific Volvo model, seats, powertrain, price, colour, wheels, package or finance request." }, { status: 502 });
  }
  let payload = await response.json();
  const functionCalls = Array.isArray(payload.output) ? payload.output.filter((item: { type?: string; name?: string }) => item.type === "function_call") : [];
  const toolCalls = functionCalls.filter((item: { name?: string }) => item.name === "search_cars");
  let rankedCars: VolvoCar[] = [];
  if (toolCalls.length) {
    const toolOutputs = toolCalls.map((call: { call_id: string; arguments?: string }) => {
      const rawArgs = JSON.parse(call.arguments || "{}") as Partial<PriceSearch>;
      const negatesMostExpensive = /\b(not the most expensive|don'?t want the most expensive|except the most expensive|anything but the most expensive|isn'?t the priciest)\b/i.test(message);
      const negatesCheapest = /\b(not the cheapest|don'?t want the cheapest|except the cheapest|anything but the cheapest)\b/i.test(message);
      const inferredSizeTier = /\b(?:large|big) (?:suv|car)s?\b/i.test(message) ? "large" : /\b(?:small|compact) cars?\b/i.test(message) ? "small" : /\bmedium cars?\b/i.test(message) ? "medium" : null;
      const args: PriceSearch = comparison?.search ?? { priceMin: typeof rawArgs.priceMin === "number" ? rawArgs.priceMin : undefined, priceMax: typeof rawArgs.priceMax === "number" ? rawArgs.priceMax : undefined, seatsMin: typeof rawArgs.seatsMin === "number" ? rawArgs.seatsMin : /\bfamily\b/i.test(message) ? 5 : undefined, bodyType: rawArgs.bodyType === "suv" || rawArgs.bodyType === "estate" || rawArgs.bodyType === "saloon" ? rawArgs.bodyType : /\bsuv\b/i.test(message) ? "suv" : /\bestate\b/i.test(message) ? "estate" : null, sizeTier: rawArgs.sizeTier === "small" || rawArgs.sizeTier === "medium" || rawArgs.sizeTier === "large" ? rawArgs.sizeTier : inferredSizeTier, powertrain: normalizedPowertrain === "electric" || normalizedPowertrain === "plug_in_hybrid" || normalizedPowertrain === "mild_hybrid" ? normalizedPowertrain : rawArgs.powertrain === "electric" || rawArgs.powertrain === "plug_in_hybrid" || rawArgs.powertrain === "mild_hybrid" ? rawArgs.powertrain : null, excludeMostExpensive: rawArgs.excludeMostExpensive === true || negatesMostExpensive, excludeCheapest: rawArgs.excludeCheapest === true || negatesCheapest, sortBy: "price", order: negatesMostExpensive || negatesCheapest ? "asc" : rawArgs.order === "desc" || /\b(expensive|premium|highest[- ]priced|most expensive)\b/.test(message.toLowerCase()) ? "desc" : "asc", limit: typeof rawArgs.limit === "number" ? rawArgs.limit : 3 };
      rankedCars = searchCars(args);
      return { type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ cars: rankedCars }) };
    });
    // The ranked result is deterministic product data. Returning it directly
    // avoids a fragile second model round-trip while retaining the model's
    // decision to invoke the tool for this ranking question.
    const extracted = {
      intent: "compare",
      relevant: true,
      confidence: 1,
      clarificationNeeded: false,
      preferences: { seats: null, budgetGbp: null, powertrain: null, colour: null, driving: null, charging: null, model: null },
      changes: { seats: null, budgetGbp: null, powertrain: null, colour: null, driving: null, charging: null, model: null, pricePreference: (/\b(expensive|premium|highest[- ]priced|most expensive)\b/.test(message.toLowerCase()) ? "highest" : /\b(cheap|cheapest|lowest[- ]priced|lowest price)\b/.test(message.toLowerCase()) ? "lowest" : null) as "highest" | "lowest" | null },
      summary: "Customer requested a Volvo UK price comparison."
    };
    const preferenceState = mergePreferenceState(savedState, extracted.changes);
    sessionState.lastResults = rankedCars;
    // Search was requested as the first step of a model-selected comparison.
    // The server owns the resulting comparison state; the LLM never infers it
    // from chat history.
    const shouldCompareResults = /\b(compar\w*|difference|versus|vs\.?)\b/i.test(message) && rankedCars.length >= 2;
    if (shouldCompareResults) sessionState.activeComparison = rankedCars.slice(0, 3);
    return NextResponse.json({ ...extracted, preferenceState, sessionState, ...buildReply(message, extracted, preferenceState, rankedCars, comparison), toolUsed: shouldCompareResults ? "search_cars → compare_cars" : "search_cars", toolResults: toolOutputs.length, search: comparison?.search, activeComparison: shouldCompareResults ? sessionState.activeComparison.map(car => car.id) : [] });
  }
  const toolCall = functionCalls[0] as { name?: string; arguments?: string } | undefined;
  if (toolCall?.name === "compare_cars") {
    let ids: string[] = [];
    try { ids = (JSON.parse(toolCall.arguments || "{}").models || []) as string[]; } catch (rawError) { console.error(rawError); }
    const models = volvoUkModels.filter(car => ids.includes(car.id));
    if (models.length >= 2) {
      sessionState.lastResults = models;
      sessionState.activeComparison = models;
      const lines = models.map(car => `${car.name}: from £${car.price.toLocaleString("en-GB")}; range ${car.rangeMiles === null ? "spec unavailable" : `${car.rangeMiles} WLTP miles`}; battery ${car.batteryKwh === null ? "spec unavailable" : `${car.batteryKwh} kWh`}; DC charging ${car.chargingSpeedKw === null ? "spec unavailable" : `${car.chargingSpeedKw} kW`}`).join(" ");
      return NextResponse.json({ intent: "compare", relevant: true, confidence: 1, clarificationNeeded: false, preferences: emptyPreferenceState, changes: emptyPreferenceState, summary: "Customer requested a Volvo comparison.", preferenceState: savedState, sessionState, assistantReply: `Here is the Volvo UK comparison. ${lines}`, recommendations: models, clarificationQuestion: "Which one would you like to configure?", toolUsed: "compare_cars", activeComparison: models.map(car => car.id) });
    }
  }
  if (toolCall?.name === "configure_car") {
    let modelId: string | null = null;
    try { modelId = JSON.parse(toolCall.arguments || "{}").model ?? null; } catch (rawError) { console.error(rawError); }
    const model = volvoUkModels.find(car => car.id === modelId);
    if (model) {
      sessionState.activeConfig = model.id;
      sessionState.activeComparison = [];
      const changes = { ...emptyPreferenceState, model: model.id };
      const preferenceState = mergePreferenceState(savedState, changes);
      return NextResponse.json({ intent: "show_model", relevant: true, confidence: 1, clarificationNeeded: false, preferences: changes, changes, summary: `Customer selected ${model.name}.`, preferenceState, sessionState, ...buildReply(message, { intent: "show_model" }, preferenceState), toolUsed: "configure_car" });
    }
  }
  if (toolCall?.name === "get_car_details") {
    let modelId: string | null = null;
    try { modelId = JSON.parse(toolCall.arguments || "{}").model ?? null; } catch (rawError) { console.error(rawError); }
    const model = volvoUkModels.find(car => car.id === modelId);
    if (model) {
      sessionState.lastResults = [model];
      const presentation = modelDetailsPresentation(model, message);
      return NextResponse.json({ intent: "show_model", relevant: true, confidence: 1, clarificationNeeded: false, preferences: emptyPreferenceState, changes: emptyPreferenceState, summary: `Customer asked about ${model.name}.`, preferenceState: savedState, sessionState, assistantReply: presentation.assistantReply, recommendations: [model], toolUsed: "get_car_details", details: presentation.details });
    }
  }
  if (toolCall?.name === "set_financing") {
    try {
      const financing = JSON.parse(toolCall.arguments || "{}") as { type: "purchase" | "pcp" | "loan" | "pch"; downPaymentPercent: number | null; termMonths: number | null };
      sessionState.lastFinancing = financing;
      return NextResponse.json({ intent: "set_financing", relevant: true, confidence: 1, clarificationNeeded: false, preferences: emptyPreferenceState, changes: emptyPreferenceState, summary: "Customer set a finance preference.", preferenceState: savedState, sessionState, assistantReply: `I’ve saved ${financing.type.toUpperCase()} as your preferred finance route${financing.termMonths ? ` over ${financing.termMonths} months` : ""}. This is not a finance quote or credit decision.`, toolUsed: "set_financing" });
    } catch (rawError) { console.error(rawError); }
  }
  const outputText = typeof payload.output_text === "string"
    ? payload.output_text
    : payload.output?.flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content || [])
      .find((content: { type?: string; text?: string }) => content.type === "output_text")?.text;
  if (!outputText) {
    console.error("OpenAI interpretation response did not contain structured text", { responseId: payload.id });
    console.error(payload);
    return NextResponse.json({ intent: "clarify", relevant: false, confidence: 0, clarificationNeeded: true, preferences: emptyPreferenceState, changes: emptyPreferenceState, summary: "The AI interpretation response was incomplete.", preferenceState: savedState, sessionState, assistantReply: "I couldn’t interpret that request right now. Please try rephrasing it as a Volvo model, requirement, comparison or configuration change." }, { status: 502 });
  }
  try {
    const extracted = JSON.parse(outputText);
    const preferenceState = mergePreferenceState(savedState, extracted.changes || {});
    return NextResponse.json({ ...extracted, preferenceState, ...buildReply(message, extracted, preferenceState, rankedCars, null, isSessionStart) });
  } catch (rawError) {
    console.error("OpenAI interpretation response did not contain valid structured text", { responseId: payload.id, outputTextPresent: Boolean(outputText) });
    console.error(rawError);
    return NextResponse.json({ intent: "clarify", relevant: false, confidence: 0, clarificationNeeded: true, preferences: emptyPreferenceState, changes: emptyPreferenceState, summary: "The AI interpretation response was invalid.", preferenceState: savedState, sessionState, assistantReply: "I couldn’t interpret that request right now. Please try rephrasing it as a Volvo model, requirement, comparison or configuration change." }, { status: 502 });
  }
}
