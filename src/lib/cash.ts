export type CashSession = {
  id: string; status: "open" | "closed"; opening_amount: number; expected_amount: number;
  cash_sales: number; card_sales: number; transfer_sales: number; total_sales: number; sales_count: number;
  opened_at: string; closed_at: string | null; closing_amount: number | null; difference: number | null;
  opened_by_name: string; closed_by_name: string | null; notes: string;
};
export type CashDashboard = { current: CashSession | null; history: CashSession[] };

// Acepta pesos con un máximo de dos decimales; no redondea dinero ingresado.
export function cashAmount(value: string): number | null {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value.trim())) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount <= 99999999.99 ? amount : null;
}

export function cashError(error: { message: string; code?: string }): string {
  if (error.message.includes("CASH_CHANGED")) return "Entraron nuevos cobros mientras contabas. Vuelve, actualiza la caja y revisa el corte antes de cerrar.";
  if (error.message.includes("CASH_ALREADY_OPEN")) return "Ya hay una caja abierta. Pulsa Actualizar caja para verla.";
  if (error.message.includes("CASH_CLOSED")) return "Otra persona ya cerró esta caja. Actualiza para consultar el corte guardado.";
  if (error.message.includes("CASH_REQUEST_CHANGED")) return "Hay una apertura pendiente de confirmar. Actualiza la caja antes de cambiar el fondo.";
  if (error.message.includes("INVALID_CASH_AMOUNT")) return "Escribe un importe válido en pesos, con un máximo de dos decimales.";
  if (error.message.includes("OWNER_REQUIRED") || error.code === "42501") return "Sólo el Dueño puede abrir, consultar y cerrar la caja.";
  return "No pudimos confirmar la caja. Actualiza para revisar si se guardó antes de reintentar.";
}
