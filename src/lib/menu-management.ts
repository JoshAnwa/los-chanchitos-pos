import type { Product } from "./pos";

export type MenuProduct = { id: string; name: string; category: string; description: string; price: number; is_active: boolean; version: number; sort_order: number };
export type MenuChange = { id: string; reason: string; before: MenuProduct | null; after: MenuProduct; actor_name: string; created_at: string };
export type MenuDashboard = { products: MenuProduct[]; changes: MenuChange[] };
export type ProductInput = { name: string; category: string; description: string; price: string; active: boolean; reason: string };

export function productPrice(value: string): number | null {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value.trim())) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= 99999999.99 ? amount : null;
}
export function validProduct(input: ProductInput, previous: MenuProduct | null): boolean {
  const price = productPrice(input.price);
  const valid = input.name.trim().length > 0 && input.name.trim().length <= 80 && !/[\u0000-\u001f\u007f]/.test(input.name)
    && input.category.trim().length > 0 && input.category.trim().length <= 40 && !/[\u0000-\u001f\u007f]/.test(input.category)
    && input.description.trim().length <= 160 && price !== null && input.reason.trim().length <= 300;
  if (!valid) return false;
  if (!previous) return true;
  if ((price !== previous.price || input.active !== previous.is_active) && input.reason.trim().length < 3) return false;
  return input.name.trim() !== previous.name || input.category.trim() !== previous.category || input.description.trim() !== previous.description
    || price !== previous.price || input.active !== previous.is_active;
}
export function saleProducts(rows: MenuProduct[]): Product[] {
  return rows.filter(row => row.is_active).map(row => ({ id: row.id, name: row.name, category: row.category, price: Number(row.price), detail: row.description ?? "" }));
}
export function menuError(error: { message: string; code?: string }): string {
  if (error.message.includes("PRODUCT_CHANGED")) return "Otra persona cambió este producto. Conserva tus datos y actualiza el menú antes de volver a editarlo.";
  if (error.message.includes("PRODUCT_REQUEST_CHANGED")) return "Primero actualiza el menú para confirmar el intento anterior antes de cambiar los datos.";
  if (error.message.includes("PRODUCT_REASON_REQUIRED")) return "Escribe un motivo de al menos tres letras para cambiar el precio o la disponibilidad.";
  if (error.message.includes("PRODUCT_NO_CHANGE")) return "El producto no tiene cambios para guardar.";
  if (error.code === "23505") return "Ya existe un producto con ese nombre. Revisa también los desactivados.";
  if (error.message.includes("INVALID_PRODUCT")) return "Revisa nombre, categoría y precio. El precio debe ser mayor que cero y tener como máximo dos decimales.";
  if (error.message.includes("OWNER_REQUIRED") || error.code === "42501") return "Tu cuenta no tiene permiso para modificar el menú. Pide ayuda al Dueño.";
  return "No pudimos confirmar el menú. Reintenta con los mismos datos o actualiza antes de cambiar el intento.";
}
