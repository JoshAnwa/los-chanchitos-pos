export const units: Record<string,string> = { kg: "kilos", g: "gramos", l: "litros", ml: "mililitros", piece: "piezas" };
export type Ingredient = { id:string; name:string; unit:string; current_stock:number; minimum_stock:number; average_cost:number; is_active:boolean; version:number };
export type RecipeItem = { ingredient_id:string; quantity:number };
export type RecipeProduct = { id:string; name:string; is_active:boolean; inventory_enabled:boolean; recipe_version:number; recipe:RecipeItem[] };
export type StockMovement = {id:string;ingredient_id:string;name:string;unit:string;type:string;quantity:number;notes:string|null;actor:string|null;created_at:string};
export type Purchase = {id:string;reference:string|null;supplier_name:string|null;total:number;received_at:string;notes:string|null;items:{name:string;unit:string;quantity:number;unit_cost:number;subtotal:number}[]};
export type InventoryDashboard = { ingredients:Ingredient[]; products:RecipeProduct[]; movements:StockMovement[]; purchases:Purchase[] };
export type BusinessSettings = {id:string;name:string;address:string;version:number};
export type SalesReport = {total:number;count:number;cancelled:number;purchases:number;methods:{method:string;amount:number}[];products:{name:string;quantity:number;amount:number}[]};
export type InventoryAction = "ingredient"|"count"|"recipe"|"purchase"|"business";
export function exactNumber(value:string,decimals=3,max=99999999.999,min=0):number|null {
  if(!new RegExp(`^\\d{1,8}(\\.\\d{1,${decimals}})?$`).test(value.trim())) return null;
  const n=Number(value);return Number.isFinite(n)&&n>=min&&n<=max?n:null;
}
export function localDay(date=new Date()):string {
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
}
export function ownerError(error:{message:string;code?:string}):string {
  if(error.code==="PGRST202") return "Falta activar la actualización de inventario en la base de datos. Tus datos se conservan; todavía no puedes guardar aquí.";
  if(error.message.includes("INVENTORY_CHANGED")) return "Las existencias o la receta cambiaron en otro equipo. Actualiza y comprueba antes de volver a guardar.";
  if(error.message.includes("INVENTORY_REQUEST_CHANGED")) return "Actualiza para comprobar el intento anterior antes de cambiar los datos.";
  if(error.message.includes("UNIT_LOCKED")) return "La unidad no se cambia después del alta. Crea otro ingrediente si necesitas una unidad diferente.";
  if(error.message.includes("INGREDIENT_IN_USE")) return "Este ingrediente está en una receta con control de inventario. Quítalo de esa receta antes de desactivarlo.";
  if(error.message.includes("INVENTORY_NO_CHANGE")) return "La cantidad contada ya coincide con las existencias. No hay ajuste que guardar.";
  if(error.message.includes("INVENTORY_REASON_REQUIRED")) return "Escribe un motivo de al menos tres letras y comprueba que el ingrediente esté disponible.";
  if(error.message.includes("INVALID_REPORT_RANGE")) return "Elige fechas válidas y un periodo de hasta un año.";
  if(error.code==="23505") return "Ya existe un ingrediente con ese nombre. Revisa también los desactivados.";
  if(error.code==="42501") return "Tu cuenta no tiene permiso para esta operación. Se necesita la cuenta Dueño y datos de este local.";
  if(error.code?.startsWith("22")) return "Revisa las cantidades y los campos. No uses negativos ni más decimales de los indicados.";
  return "No se confirmó la operación. Conservamos el intento: reintenta igual o actualiza para comprobarlo antes de cambiar datos.";
}
