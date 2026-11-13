import { createClient } from "./supabase/client";
import { runOrderRequest, ORDER_REQUEST_TIMEOUT_MESSAGE } from "./order-request";
import { cashError, type CashDashboard, type CashSession } from "./cash";

async function request<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  try {
    const { data, error } = await runOrderRequest(signal => createClient().rpc(name, args).abortSignal(signal));
    if (error) throw new Error(cashError(error));
    return data as T;
  } catch (reason) {
    if (reason instanceof Error && reason.message !== ORDER_REQUEST_TIMEOUT_MESSAGE && !(reason instanceof TypeError)) throw reason;
    throw new Error("No pudimos confirmar la caja por la conexión. Puede haberse guardado: reintenta con los mismos datos o pulsa Actualizar caja antes de cambiar el importe.");
  }
}
export const getCashDashboard = () => request<CashDashboard>("get_cash_dashboard");
export const getCashStatus = () => request<{ open: boolean }>("get_pos_cash_status");
export const openCash = (id: string, amount: number) => request<CashSession>("open_cash_session", { p_id: id, p_opening_amount: amount });
export const closeCash = (session: CashSession, amount: number, notes: string) => request<CashSession>("close_cash_session", {
  p_id: session.id, p_closing_amount: amount, p_sales_count: session.sales_count, p_notes: notes,
});
