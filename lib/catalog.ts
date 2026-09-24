export type Item = { id: string; name: string; priceDelta: number; hex?: string; requiresTrim?: string[]; incompatibleWith?: string[]; availableFor?: string[] };
export type VehicleSize = "small" | "medium" | "large";
export type Model = { id: string; name: string; basePrice: number; bodyType: "suv" | "crossover" | "estate" | "saloon"; sizeTier: VehicleSize };
export const catalog = {
  // Demonstration prices are a static UK snapshot. Live Volvo systems must
  // supply market, model-year, trim and compatibility data in production.
  models: [
    { id: "ex30", name: "Volvo EX30", basePrice: 33060, bodyType: "suv", sizeTier: "small" },
    { id: "xc40", name: "Volvo XC40", basePrice: 32860, bodyType: "suv", sizeTier: "small" },
    { id: "ex40", name: "Volvo EX40", basePrice: 42360, bodyType: "suv", sizeTier: "small" },
    { id: "ec40", name: "Volvo EC40", basePrice: 44860, bodyType: "crossover", sizeTier: "small" },
    { id: "v60", name: "Volvo V60", basePrice: 45210, bodyType: "estate", sizeTier: "medium" },
    { id: "xc60", name: "Volvo XC60", basePrice: 49860, bodyType: "suv", sizeTier: "medium" },
    { id: "ex60", name: "Volvo EX60", basePrice: 56860, bodyType: "suv", sizeTier: "medium" },
    { id: "es90", name: "Volvo ES90", basePrice: 65060, bodyType: "saloon", sizeTier: "large" },
    { id: "xc90", name: "Volvo XC90", basePrice: 66270, bodyType: "suv", sizeTier: "large" },
    { id: "ex90", name: "Volvo EX90", basePrice: 73160, bodyType: "suv", sizeTier: "large" }
  ] satisfies Model[],
  trims: [
    { id: "core", name: "Core", priceDelta: 0 }, { id: "plus", name: "Plus", priceDelta: 3000 }, { id: "ultra", name: "Ultra", priceDelta: 6000 }
  ] satisfies Item[],
  colors: [
    { id:"onyx-black", name:"Onyx Black", priceDelta:900, hex:"#101114" }, { id:"crystal-white", name:"Crystal White", priceDelta:0, hex:"#e6e5e0" },
    { id:"fjord-blue", name:"Fjord Blue", priceDelta:900, hex:"#193d69" }, { id:"sage-green", name:"Sage Green", priceDelta:1100, hex:"#294236" },
    { id:"cloud-blue", name:"Cloud Blue", priceDelta:1100, hex:"#6d8da6" }, { id:"vapour-grey", name:"Vapour Grey", priceDelta:900, hex:"#82878a" },
    { id:"sand-dune", name:"Sand Dune", priceDelta:900, hex:"#b8a28b" }, { id:"silver-dawn", name:"Silver Dawn", priceDelta:1400, hex:"#d8ddd9" }
  ] satisfies Item[],
  wheels: [
    { id:"19-aero", name:'19" Aero alloy wheels', priceDelta:0 }, { id:"20-turbine", name:'20" Aero alloy wheels', priceDelta:1200 },
    { id:"21-diamond-cut", name:'21" diamond-cut alloy wheels', priceDelta:1800, requiresTrim:["plus","ultra"], availableFor:["ex60","es90","xc90","ex90"] }, { id:"21-black", name:'21" black alloy wheels', priceDelta:2100, requiresTrim:["plus","ultra"], availableFor:["ex60","xc90","ex90"] }
  ] satisfies Item[],
  options: [
    {id:"panoramic-roof",name:"Panoramic roof",priceDelta:1600,availableFor:["ex40","ec40","xc60","ex60","es90","xc90","ex90"]}, {id:"climate-pack",name:"Climate pack",priceDelta:1800},
    {id:"driver-assist",name:"Driver assistance pack",priceDelta:2200}, {id:"harman-kardon",name:"Harman Kardon Premium Sound",priceDelta:1400},
    {id:"towbar",name:"Towbar",priceDelta:1100}, {id:"winter-wheels",name:"Winter wheel set",priceDelta:900},
    {id:"charcoal-interior",name:"Charcoal interior",priceDelta:0,incompatibleWith:["zinc-interior"]}, {id:"zinc-interior",name:"Zinc interior",priceDelta:0,incompatibleWith:["charcoal-interior"]},
    {id:"heated-rear-seats",name:"Heated rear seats",priceDelta:500,requiresTrim:["plus","ultra"]}
  ] satisfies Item[]
};
export type Config = { model: string; trim: string; color: string; wheels: string; options: string[] };
export const defaultConfig: Config = { model:"ex40", trim:"core", color:"crystal-white", wheels:"19-aero", options:[] };
export const find = (collection: Item[], id: string) => collection.find(item => item.id === id);
