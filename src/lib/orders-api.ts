import { createClient } from "./supabase/client";
import { runOrderRequest } from "./order-request";
import type { DemoOrder, Draft, Payment, Product } from "./pos";

export type DatabaseOrder = {
  id: string; number: number; version: number; type: "table" | "takeaway"; table_label: string | null;
  status: string; total: number; notes: string; created_at: string; paid_at: string | null;
  items: { product_id: string; name: string; quantity: number; unit_price: number }[];
  payments: Payment[];
};

export function fromDatabaseOrder(row: DatabaseOrder, products: Product[]): DemoOrder {
  return {
    id: row.id, orderId: row.id, version: row.version, number: String(row.number).padStart(4, "0"),
    label: row.type === "table" ? row.table_label! : "Para llevar",
    status: row.status === "paid" ? "pagado" : "pedido", notes: row.notes ?? "", dirty: false,
    total: Number(row.total), payments: row.payments.map((payment) => ({ ...payment, amount: Number(payment.amount) })),
    time: new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Mexico_City" }).format(new Date(row.paid_at ?? row.created_at)),
    lines: row.items.map((item) => ({
      id: item.product_id, name: item.name, quantity: item.quantity, price: Number(item.unit_price),
      category: products.find((product) => product.id === item.product_id)?.category ?? "Menú",
      detail: products.find((product) => product.id === item.product_id)?.detail ?? "",
    })),
  };
}

export function orderError(error: { message: string; code?: string }): string {
  if (error.message.includes("STOCK_INSUFFICIENT")) return "No alcanza un ingrediente de la receta. No se registró el cobro. El Dueño debe revisar las existencias en Inventario antes de reintentar.";
  if (error.message.includes("CASH_REQUIRED")) return "La caja está cerrada. Pide al Dueño que la abra y actualiza antes de cobrar. El pedido guardado se conserva.";
  if (error.message.includes("ORDER_CHANGED")) return "Otra persona modificó este pedido. Conservamos tus cambios en pantalla: anótalos y pulsa Actualizar pedidos para cargar la última versión.";
  if (error.message.includes("TABLE_OCCUPIED")) return "Esta mesa ya tiene un pedido guardado por otra persona. Pulsa Actualizar pedidos para abrirlo.";
  if (error.message.includes("ORDER_CLOSED")) return "Este pedido ya está pagado o cancelado. Actualiza los pedidos antes de continuar.";
  if (error.message.includes("STAFF_REQUIRED") || error.code === "42501") return "Tu acceso no está autorizado. Pide al dueño que revise tu cuenta.";
  if (error.message.includes("PAYMENT_MISMATCH")) return "El pago no coincide con el total guardado. Revisa los importes antes de confirmar.";
  if (error.message.includes("PRODUCT_UNAVAILABLE")) return "Un producto ya no está disponible. Revisa el menú antes de guardar.";
  if (error.message.includes("REASON_REQUIRED")) return "Escribe un motivo de al menos tres letras para cancelar.";
  return "No pudimos confirmar la operación. Revisa tu conexión e intenta de nuevo; el reintento no duplicará el cobro.";
}

export async function listOrders(products: Product[]): Promise<DemoOrder[]> {
  const { data, error } = await runOrderRequest((signal) => createClient().rpc("list_pos_orders").abortSignal(signal));
  if (error) throw new Error(orderError(error));
  return (data as DatabaseOrder[]).map((row) => fromDatabaseOrder(row, products));
}

export async function saveOrder(draft: Draft, destination: string, requestId: string, products: Product[]): Promise<DemoOrder> {
  const { data, error } = await runOrderRequest((signal) => createClient().rpc("save_pos_order", {
    p_id: draft.orderId, p_version: draft.version ?? 0, p_request_id: requestId,
    p_type: destination === "Para llevar" ? "takeaway" : "table",
    p_table_label: destination === "Para llevar" ? null : destination,
    p_items: draft.lines.map((line) => ({ product_id: line.id, quantity: line.quantity })), p_notes: draft.notes,
  }).abortSignal(signal));
  if (error) throw new Error(orderError(error));
  return fromDatabaseOrder(data as DatabaseOrder, products);
}

export async function payOrder(order: DemoOrder, payments: Payment[], requestId: string, products: Product[]): Promise<DemoOrder> {
  const { data, error } = await runOrderRequest((signal) => createClient().rpc("pay_pos_order", {
    p_id: order.id, p_version: order.version, p_request_id: requestId, p_payments: payments,
  }).abortSignal(signal));
  if (error) throw new Error(orderError(error));
  return fromDatabaseOrder(data as DatabaseOrder, products);
}

export async function cancelOrder(draft: Draft, reason: string): Promise<void> {
  const { error } = await runOrderRequest((signal) => createClient().rpc("cancel_pos_order", { p_id: draft.orderId, p_version: draft.version, p_reason: reason }).abortSignal(signal));
  if (error) throw new Error(orderError(error));
}

export function orderKey(order: DemoOrder): string {
  return order.label === "Para llevar" ? `takeaway:${order.id}` : order.label;
}

export function restoreDrafts(orders: DemoOrder[]): Record<string, Draft> {
  return Object.fromEntries(orders.filter((order) => order.status === "pedido").map((order) => [orderKey(order), {
    lines: order.lines, notes: order.notes, orderId: order.id, version: order.version, number: order.number, dirty: false,
  }]));
}
