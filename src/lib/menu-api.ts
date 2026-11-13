import { createClient } from "./supabase/client";
import { runOrderRequest, ORDER_REQUEST_TIMEOUT_MESSAGE } from "./order-request";
import { menuError, productPrice, type MenuDashboard, type MenuProduct, type ProductInput } from "./menu-management";

async function request<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  try {
    const { data, error } = await runOrderRequest(signal => createClient().rpc(name, args).abortSignal(signal));
    if (error) throw new Error(menuError(error));
    return data as T;
  } catch (reason) {
    if (reason instanceof Error && reason.message !== ORDER_REQUEST_TIMEOUT_MESSAGE && !(reason instanceof TypeError)) throw reason;
    throw new Error("No pudimos confirmar el cambio por la conexión. Puede haberse guardado: reintenta con los mismos datos o actualiza el menú antes de cambiar el importe.");
  }
}
export const getMenuDashboard = () => request<MenuDashboard>("get_menu_dashboard");
export const getPosMenu = () => request<MenuProduct[]>("list_pos_products");
export const saveMenuProduct = (id: string, version: number, requestId: string, input: ProductInput) => request<MenuProduct>("save_menu_product", {
  p_id: id, p_version: version, p_request_id: requestId, p_name: input.name.trim(), p_category: input.category.trim(),
  p_description: input.description.trim(), p_price: productPrice(input.price), p_is_active: input.active, p_reason: input.reason.trim(),
});
