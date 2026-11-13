export type Product = { id: string; name: string; category: string; price: number; detail: string };
export type CartLine = Product & { quantity: number };
export type PaymentMethod = "cash" | "card" | "transfer" | "combined";
export type Payment = { method: "cash" | "card" | "transfer"; amount: number };
export type Draft = { lines: CartLine[]; notes: string; orderId?: string; version?: number; number?: string; dirty?: boolean };
export type DemoOrder = Draft & { id: string; label: string; status: "pedido" | "pagado"; total: number; time: string; payments?: Payment[] };

export const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const orderTotal = (lines: CartLine[]) => roundMoney(lines.reduce((sum, line) => sum + line.price * line.quantity, 0));
export const newDraft = (): Draft => ({ lines: [], notes: "" });
export const paymentLabels = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", combined: "Combinado" };
export const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
