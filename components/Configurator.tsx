"use client";

import { useState } from "react";
import { catalog, Config, defaultConfig, find, Item } from "../lib/catalog";
import { normalizeConfigForModel, total, validateItem } from "../lib/configEngine";

type PreferenceState = {
  seats: number | null;
  budgetGbp: number | null;
  powertrain: string | null;
  colour: string | null;
  driving: string | null;
  charging: string | null;
  model: string | null;
  pricePreference: "lowest" | "highest" | null;
};

type Interpretation = {
  intent: string;
  relevant: boolean;
  confidence: number;
  summary: string;
  assistantReply?: string;
  clarificationQuestion?: string | null;
  preferenceState?: PreferenceState;
  recommendations?: Array<{
    id?: string;
    name: string;
    price: number;
    rangeMiles?: number | null;
    batteryKwh?: number | null;
    chargingSpeedKw?: number | null;
  }>;
  configurationChanges?: {
    trim?: string;
    color?: string;
    wheels?: string;
    addOptions?: string[];
    removeOptions?: string[];
  };
};

type ComparisonCar = {
  id: string;
  name: string;
  price: number;
  rangeMiles: number | null;
  batteryKwh: number | null;
  chargingSpeedKw: number | null;
};

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  comparison?: ComparisonCar[];
};

const money = (value: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(value);

function Choice({
  item,
  active,
  disabled,
  priceLabel,
  onChoose,
}: {
  item: Item;
  active: boolean;
  disabled?: boolean;
  priceLabel?: string;
  onChoose: () => void;
}) {
  const stateClass = active
    ? "border-stone-950 bg-stone-950 text-white"
    : "border-stone-200 bg-white hover:border-stone-500";
  const disabledClass = disabled ? " cursor-not-allowed opacity-40" : "";
  return (
    <button
      disabled={disabled}
      onClick={onChoose}
      className={"rounded-xl border p-3 text-left transition " + stateClass + disabledClass}
    >
      <span className="block text-sm font-medium">{item.name}</span>
      <span className={"mt-1 block text-xs " + (active ? "text-stone-300" : "text-stone-500")}>
        {priceLabel || (item.priceDelta ? "+" + money(item.priceDelta) : "Included")}
      </span>
    </button>
  );
}

function VehiclePreview({
  colour,
  sizeTier,
  modelName,
}: {
  colour: string;
  sizeTier: "small" | "medium" | "large";
  modelName: string;
}) {
  const width = { small: "72%", medium: "86%", large: "100%" }[sizeTier];

  return (
    <div className="absolute bottom-0 left-1/2 h-[242px] -translate-x-1/2" style={{ width }}>
      <img
        src="/vehicles/compact-suv-preview.png"
        alt={modelName + " representative SUV preview"}
        className="h-full w-full object-contain"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-[22%_9%_20%_7%] rounded-[36%] opacity-20 mix-blend-color"
        style={{ background: colour }}
      />
    </div>
  );
}

function CarVisual({ config }: { config: Config }) {
  const colour = find(catalog.colors, config.color);
  const trim = find(catalog.trims, config.trim);
  const model = catalog.models.find((item) => item.id === config.model);
  const sizeTier = model?.sizeTier || "medium";
  const bodyType = model?.bodyType || "suv";
  const vehicleLabel = sizeTier.charAt(0).toUpperCase() + sizeTier.slice(1) + " " + bodyType;

  return (
    <section className="relative min-h-[340px] overflow-hidden rounded-3xl bg-stone-900 p-7 text-white">
      <div
        className="absolute inset-0 opacity-30"
        style={{ background: "radial-gradient(circle at 65% 35%, " + (colour?.hex || "#54706f") + ", transparent 42%)" }}
      />
      <div className="relative z-10">
        <p className="text-xs font-bold tracking-[.18em] text-stone-400">CURRENT BUILD</p>
        <h2 className="mt-2 text-4xl font-semibold tracking-tight">{model?.name || "Volvo Cars UK configuration"}</h2>
        <p className="mt-1 text-sm text-stone-300">{trim?.name} · {colour?.name}</p>
        <span className="mt-4 inline-block rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium text-stone-200">
          {vehicleLabel}
        </span>
      </div>
      <VehiclePreview colour={colour?.hex || "#54706f"} sizeTier={sizeTier} modelName={model?.name || "Volvo vehicle"} />
      <p className="absolute bottom-5 right-7 z-10 text-xs text-stone-400">Representative SUV preview · proportions update by model size</p>
    </section>
  );
}

function ComparisonTable({ cars }: { cars: ComparisonCar[] }) {
  if (cars.length < 2) return null;
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-stone-200 bg-white">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-stone-50 text-stone-500">
          <tr>
            <th className="px-3 py-2 font-medium">Model</th>
            <th className="px-3 py-2 font-medium">From</th>
            <th className="px-3 py-2 font-medium">Range</th>
            <th className="px-3 py-2 font-medium">Battery</th>
            <th className="px-3 py-2 font-medium">Charge</th>
          </tr>
        </thead>
        <tbody>
          {cars.map((car) => (
            <tr key={car.id} className="border-t border-stone-100">
              <td className="px-3 py-2 font-medium">{car.name}</td>
              <td className="px-3 py-2">{money(car.price)}</td>
              <td className="px-3 py-2">{car.rangeMiles === null ? "Unavailable" : car.rangeMiles + " mi"}</td>
              <td className="px-3 py-2">{car.batteryKwh === null ? "Unavailable" : car.batteryKwh + " kWh"}</td>
              <td className="px-3 py-2">{car.chargingSpeedKw === null ? "Unavailable" : car.chargingSpeedKw + " kW"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function applyConfigurationChanges(changes: Interpretation["configurationChanges"]) {
  if (!changes) return;
  const clickChoice = (id: string, group: Item[]) => {
    const label = find(group, id)?.name;
    const button = label
      ? (Array.from(document.querySelectorAll("button")).find((element) =>
          element.textContent?.trim().startsWith(label),
        ) as HTMLButtonElement | undefined)
      : undefined;
    button?.click();
  };
  if (changes.trim) clickChoice(changes.trim, catalog.trims);
  if (changes.color) clickChoice(changes.color, catalog.colors);
  window.setTimeout(() => {
    if (changes.wheels) clickChoice(changes.wheels, catalog.wheels);
    for (const id of changes.addOptions || []) {
      const label = find(catalog.options, id)?.name;
      const button = label
        ? (Array.from(document.querySelectorAll("button")).find((element) =>
            element.textContent?.trim().startsWith(label),
          ) as HTMLButtonElement | undefined)
        : undefined;
      if (button && !button.className.includes("bg-stone-950")) button.click();
    }
    for (const id of changes.removeOptions || []) {
      const label = find(catalog.options, id)?.name;
      const button = label
        ? (Array.from(document.querySelectorAll("button")).find((element) =>
            element.textContent?.trim().startsWith(label),
          ) as HTMLButtonElement | undefined)
        : undefined;
      if (button?.className.includes("bg-stone-950")) button.click();
    }
  }, 0);
}

function ChatPanel({
  onInterpret,
  onNextStep,
  onUndo,
  onReset,
}: {
  onInterpret: (result: Interpretation) => void;
  onNextStep: () => void;
  onUndo: () => void;
  onReset: () => void;
}) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Tell me what you need and I’ll recommend a Volvo Cars UK model, then help you configure it.",
    },
  ]);
  const [preferenceState, setPreferenceState] = useState<PreferenceState>({
    seats: null,
    budgetGbp: null,
    powertrain: null,
    colour: null,
    driving: null,
    charging: null,
    model: null,
    pricePreference: null,
  });
  const [sessionId] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(false);

  async function send() {
    const value = message.trim();
    if (!value || loading) return;
    const conversation = [...messages, { role: "user" as const, text: value }];
    setMessage("");
    setMessages(conversation);
    setLoading(true);

    try {
      const response = await fetch("/api/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: value,
          sessionId,
          conversation,
          profile: {
            market: "Volvo Cars UK",
            currentConfiguration: "Volvo EX40 prototype configuration",
            preferenceState,
          },
        }),
      });
      const result = (await response.json()) as Interpretation;
      if (!response.ok) throw new Error(result.assistantReply || "Could you rephrase that?");
      if (result.preferenceState) setPreferenceState(result.preferenceState);
      if (result.intent === "next_step") onNextStep();
      if (result.intent === "undo") onUndo();
      if (result.intent === "reset") onReset();
      applyConfigurationChanges(result.configurationChanges);

      const fallback = result.relevant
        ? result.summary
        : "Could you rephrase that in terms of a Volvo Cars UK model or configuration?";
      const reply =
        (result.assistantReply || fallback) +
        (result.clarificationQuestion ? " " + result.clarificationQuestion : "");
      const comparison =
        result.intent === "compare" && result.recommendations && result.recommendations.length >= 2
          ? result.recommendations.map((car) => ({
              id: car.id || car.name,
              name: car.name,
              price: car.price,
              rangeMiles: car.rangeMiles ?? null,
              batteryKwh: car.batteryKwh ?? null,
              chargingSpeedKw: car.chargingSpeedKw ?? null,
            }))
          : undefined;
      setMessages((current) => [...current, { role: "assistant", text: reply, comparison }]);
      onInterpret(result);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { role: "assistant", text: error instanceof Error ? error.message : "Could you rephrase that?" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">Configurator assistant</h2>
        <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-800">Volvo UK assistant</span>
      </div>
      <div className="max-h-80 space-y-3 overflow-y-auto pr-1 text-sm">
        {messages.map((entry, index) => (
          <div
            key={index}
            className={"max-w-[90%] rounded-xl p-3 " + (entry.role === "user" ? "ml-auto bg-stone-950 text-white" : "bg-stone-100 text-stone-950")}
          >
            <p>{entry.text}</p>
            {entry.role === "assistant" && entry.comparison ? <ComparisonTable cars={entry.comparison} /> : null}
          </div>
        ))}
        {loading ? <div className="max-w-[90%] rounded-xl bg-stone-100 p-3 text-stone-500">Looking up Volvo Cars UK options…</div> : null}
      </div>
      <div className="mt-4 rounded-xl border border-dashed border-stone-200 p-3 text-sm text-stone-500">
        Try: “I need seven seats, but something cheaper than the EX60.”
      </div>
      <div className="mt-5 flex gap-2">
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send();
          }}
          placeholder="Describe what you need…"
          className="min-w-0 flex-1 rounded-lg border border-stone-200 px-3 py-3 text-sm"
        />
        <button onClick={send} disabled={loading} className="rounded-lg bg-stone-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
          {loading ? "Thinking…" : "Send"}
        </button>
      </div>
      <p className="mt-3 text-xs text-stone-500">
        Recommendations use the Volvo UK snapshot. Live configuration, pricing, finance and availability still require Volvo systems.
      </p>
    </section>
  );
}

function Summary({ config, price, onContinue, onCopy }: { config: Config; price: number; onContinue: () => void; onCopy: () => void }) {
  const entries = [
    find(catalog.trims, config.trim),
    find(catalog.colors, config.color),
    find(catalog.wheels, config.wheels),
    ...config.options.map((id) => find(catalog.options, id)),
  ].filter(Boolean) as Item[];
  const model = catalog.models.find((item) => item.id === config.model);

  return (
    <aside className="h-fit rounded-2xl border border-stone-200 bg-white p-5 lg:sticky lg:top-6">
      <p className="text-xs font-bold tracking-[.16em] text-stone-500">YOUR BUILD</p>
      <h2 className="mt-2 text-2xl font-semibold">{model?.name || "Volvo Cars UK configuration"}</h2>
      <ul className="my-5 space-y-3 border-y border-stone-100 py-4">
        <li className="flex justify-between gap-3 text-sm">
          <span>Base vehicle</span>
          <span className="text-stone-500">{money(model?.basePrice || 0)}</span>
        </li>
        {entries.map((item) => (
          <li className="flex justify-between gap-3 text-sm" key={item.id}>
            <span>{item.name}</span>
            <span className="text-stone-500">{item.priceDelta ? "+" + money(item.priceDelta) : "Included"}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-stone-500">Indicative vehicle price</p>
      <p className="mt-1 text-3xl font-semibold">{money(price)}</p>
      <button onClick={onContinue} className="mt-5 w-full rounded-lg bg-stone-950 px-4 py-3 text-sm font-semibold text-white">
        Take me to the next step
      </button>
      <button onClick={onCopy} className="mt-2 w-full rounded-lg border border-stone-200 px-4 py-3 text-sm font-semibold text-stone-800">
        Copy build summary
      </button>
    </aside>
  );
}

function OrderDetails({ price, onBack }: { price: number; onBack: () => void }) {
  const [finance, setFinance] = useState("purchase");
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <section className="mx-auto max-w-2xl rounded-3xl border border-stone-200 bg-white p-8 text-center">
        <p className="text-xs font-bold tracking-[.16em] text-stone-500">ENQUIRY READY</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Your retailer handoff is ready</h1>
        <p className="mx-auto mt-4 max-w-lg text-stone-600">
          In production, this step sends the configured car and finance interest to the selected Volvo retailer. No order has been placed in this prototype.
        </p>
        <button onClick={onBack} className="mt-7 rounded-lg bg-stone-950 px-5 py-3 text-sm font-semibold text-white">Back to configuration</button>
      </section>
    );
  }

  const routes = [
    ["purchase", "Purchase"],
    ["pcp", "Personal Contract Purchase"],
    ["loan", "Volvo Loan"],
    ["pch", "Personal Contract Hire"],
  ];

  return (
    <section className="mx-auto max-w-4xl space-y-6">
      <button onClick={onBack} className="text-sm font-medium text-stone-600 hover:text-stone-950">← Back to configuration</button>
      <div>
        <p className="text-xs font-bold tracking-[.16em] text-stone-500">UK ORDER JOURNEY</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">A few more details before retailer handoff</h1>
        <p className="mt-3 text-stone-600">Configured vehicle price: <b className="text-stone-950">{money(price)}</b>. Finance figures are illustrative until a live quote is retrieved.</p>
      </div>
      <section className="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 className="text-xl font-semibold">Finance route</h2>
        <p className="mt-2 text-sm text-stone-600">Choose a route to discuss with the retailer. This is not a credit application.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {routes.map(([id, name]) => (
            <button
              key={id}
              onClick={() => setFinance(id)}
              className={"rounded-xl border p-4 text-left " + (finance === id ? "border-stone-950 bg-stone-950 text-white" : "border-stone-200 bg-white")}
            >
              <b>{name}</b>
            </button>
          ))}
        </div>
      </section>
      <section className="rounded-2xl border border-stone-200 bg-white p-6">
        <h2 className="text-xl font-semibold">Retailer contact</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <input className="rounded-lg border border-stone-200 px-3 py-3" placeholder="Name" />
          <input className="rounded-lg border border-stone-200 px-3 py-3" placeholder="Email or phone" />
          <input className="rounded-lg border border-stone-200 px-3 py-3" placeholder="Postcode or preferred retailer" />
          <select className="rounded-lg border border-stone-200 bg-white px-3 py-3">
            <option>Request a test drive</option>
            <option>Contact me about this build</option>
          </select>
        </div>
        <button onClick={() => setSent(true)} className="mt-5 rounded-lg bg-stone-950 px-5 py-3 text-sm font-semibold text-white">
          Prepare retailer enquiry
        </button>
      </section>
    </section>
  );
}

export function Configurator() {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [history, setHistory] = useState<Config[]>([]);
  const [notice, setNotice] = useState("Select a colour, wheel or option to build your Volvo Cars UK configuration.");
  const [stage, setStage] = useState<"configure" | "order">("configure");
  const price = total(config);

  function commit(next: Config, nextNotice: string) {
    setHistory((current) => [...current, config]);
    setConfig(next);
    setNotice(nextNotice);
  }

  function updateModel(modelId: string) {
    const model = catalog.models.find((item) => item.id === modelId);
    if (!model) return;
    const next = normalizeConfigForModel({ ...config, model: modelId });
    commit(next, `${model.name} selected. Incompatible prototype choices were removed.`);
  }

  function undo() {
    setHistory((current) => {
      const previous = current[current.length - 1];
      if (!previous) {
        setNotice("There is no earlier configuration change to undo.");
        return current;
      }
      setConfig(previous);
      setNotice("Last configuration change undone.");
      return current.slice(0, -1);
    });
  }

  function resetBuild() {
    setHistory([]);
    setConfig(defaultConfig);
    setNotice("Build reset to the EX40 prototype starting point.");
  }

  function update(key: "trim" | "color" | "wheels", item: Item) {
    const next = { ...config, [key]: item.id };
    const result = validateItem(item, next);
    if (!result.valid) {
      setNotice(result.reason || "That choice is not compatible with the current build.");
      return;
    }
    if (key === "trim") {
      const wheel = find(catalog.wheels, next.wheels);
      if (wheel && !validateItem(wheel, next).valid) next.wheels = "19-aero";
      next.options = next.options.filter((id) => {
        const option = find(catalog.options, id);
        return option ? validateItem(option, next).valid : false;
      });
    }
    commit(next, item.name + " selected.");
  }

  function toggleOption(item: Item) {
    const selected = config.options.includes(item.id);
    const next = {
      ...config,
      options: selected ? config.options.filter((id) => id !== item.id) : [...config.options, item.id],
    };
    const result = selected ? { valid: true } : validateItem(item, config);
    if (!result.valid) {
      setNotice(result.reason || "That option is not compatible with the current build.");
      return;
    }
    commit(next, item.name + (selected ? " removed." : " added."));
  }

  if (stage === "order") {
    return <main className="min-h-screen bg-stone-100 px-6 py-8"><OrderDetails price={price} onBack={() => setStage("configure")} /></main>;
  }

  return (
    <main className="min-h-screen bg-stone-100">
      <header className="border-b border-stone-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <a className="font-semibold tracking-tight" href="/">VOLVO CARS UK</a>
          <span className="text-xs text-stone-500">AI configuration assistant</span>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-7 lg:grid-cols-[1.15fr_.85fr]">
        <div className="space-y-6">
          <CarVisual config={config} />
          <ChatPanel
            onInterpret={(result) => {
              if (result.intent === "undo" || result.intent === "reset") return;
              const selectedModel = result.preferenceState?.model;
              if (selectedModel && catalog.models.some((model) => model.id === selectedModel)) {
                updateModel(selectedModel);
              } else if (result.summary) {
                setNotice("AI understood: " + result.summary + " (" + Math.round(result.confidence * 100) + "% confidence). Review before applying any change.");
              }
            }}
            onNextStep={() => setStage("order")}
            onUndo={undo}
            onReset={resetBuild}
          />
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="mb-5">
              <p className="text-xs font-bold tracking-[.16em] text-stone-500">CONFIGURE</p>
              <p className="mt-2 text-sm text-stone-600">{notice}</p>
            </div>
            <div className="mb-7 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-semibold">Model</h3>
                <p className="mt-1 text-xs text-stone-500">Changing model keeps only compatible prototype choices.</p>
              </div>
              <button onClick={undo} disabled={!history.length} className="rounded-lg border border-stone-200 px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40">Undo</button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {catalog.models.map((item) => <Choice key={item.id} item={{ id: item.id, name: item.name, priceDelta: item.basePrice }} priceLabel={`From ${money(item.basePrice)}`} active={config.model === item.id} onChoose={() => updateModel(item.id)} />)}
            </div>
            <h3 className="mb-3 mt-7 font-semibold">Trim</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {catalog.trims.map((item) => <Choice key={item.id} item={item} active={config.trim === item.id} onChoose={() => update("trim", item)} />)}
            </div>
            <h3 className="mb-3 mt-7 font-semibold">Exterior colour</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {catalog.colors.map((item) => <Choice key={item.id} item={item} active={config.color === item.id} onChoose={() => update("color", item)} />)}
            </div>
            <h3 className="mb-3 mt-7 font-semibold">Wheels</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {catalog.wheels.map((item) => (
                <Choice key={item.id} item={item} active={config.wheels === item.id} disabled={!validateItem(item, config).valid && config.wheels !== item.id} onChoose={() => update("wheels", item)} />
              ))}
            </div>
            <h3 className="mb-3 mt-7 font-semibold">Interior</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {catalog.options.filter((item) => item.id.endsWith("-interior")).map((item) => (
                <Choice key={item.id} item={item} active={config.options.includes(item.id)} disabled={!config.options.includes(item.id) && !validateItem(item, config).valid} onChoose={() => toggleOption(item)} />
              ))}
            </div>
            <h3 className="mb-3 mt-7 font-semibold">Packages</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {catalog.options.filter((item) => item.id.endsWith("-pack")).map((item) => (
                <Choice key={item.id} item={item} active={config.options.includes(item.id)} disabled={!config.options.includes(item.id) && !validateItem(item, config).valid} onChoose={() => toggleOption(item)} />
              ))}
            </div>
            <h3 className="mb-3 mt-7 font-semibold">Individual options</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {catalog.options.filter((item) => !item.id.endsWith("-pack") && !item.id.endsWith("-interior")).map((item) => (
                <Choice key={item.id} item={item} active={config.options.includes(item.id)} disabled={!config.options.includes(item.id) && !validateItem(item, config).valid} onChoose={() => toggleOption(item)} />
              ))}
            </div>
          </section>
        </div>
        <Summary config={config} price={price} onContinue={() => setStage("order")} onCopy={() => {
          const model = catalog.models.find((item) => item.id === config.model);
          const selected = [find(catalog.trims, config.trim), find(catalog.colors, config.color), find(catalog.wheels, config.wheels), ...config.options.map((id) => find(catalog.options, id))].filter(Boolean).map((item) => (item as Item).name);
          navigator.clipboard.writeText(`${model?.name || "Volvo Cars UK"}\n${selected.join(" · ")}\nIndicative price: ${money(price)}`);
          setNotice("Build summary copied. Prices and availability remain indicative until live Volvo checkout.");
        }} />
      </div>
    </main>
  );
}
