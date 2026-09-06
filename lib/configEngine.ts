import { catalog, Config, find, Item } from "./catalog";
export type Validation = { valid: boolean; reason?: string };
export function validateItem(item: Item | undefined, config: Config): Validation {
  if (!item) return { valid:false, reason:"Unknown catalogue item." };
  if (item.requiresTrim && !item.requiresTrim.includes(config.trim)) return { valid:false, reason:`${item.name} requires ${item.requiresTrim.map(id => find(catalog.trims,id)?.name).join(" or ")}.` };
  if (item.incompatibleWith?.some(id => config.options.includes(id))) return { valid:false, reason:`${item.name} conflicts with an option already selected.` };
  return { valid:true };
}
export function total(config: Config) { const model=catalog.models.find(item=>item.id===config.model)?.basePrice ?? 0, trim=find(catalog.trims,config.trim)?.priceDelta ?? 0, color=find(catalog.colors,config.color)?.priceDelta ?? 0, wheels=find(catalog.wheels,config.wheels)?.priceDelta ?? 0, options=config.options.reduce((sum,id)=>sum+(find(catalog.options,id)?.priceDelta ?? 0),0); return model+trim+color+wheels+options; }
