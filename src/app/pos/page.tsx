import { redirect } from "next/navigation";
import { isSupabaseConfigured, isDemoAvailable } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { initialMenu } from "@/lib/menu";
import type { Product, DemoOrder } from "@/lib/pos";
import { fromDatabaseOrder, type DatabaseOrder } from "@/lib/orders-api";
import { AccessPending } from "@/components/access-pending";
import { PosShell } from "./pos-shell";

export default async function PosPage() {
  if (!isSupabaseConfigured && !isDemoAvailable) redirect("/login");
  let userName = "Usuario de prueba";
  let role = "Dueño · Demo";
  let products: Product[] = initialMenu;
  let loadError: string | undefined;
  let orders: DemoOrder[] = [];
  let isOwner = false;
  let cashOpen: boolean | null = null;

  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) redirect("/login");

    const userId = userData.user.id;
    const [profileResult, productResult] = await Promise.all([
      supabase.from("profiles").select("full_name, role, is_active").eq("id", userId).single(),
      supabase.from("products").select("id, name, category, price, description").eq("is_active", true).order("sort_order"),
    ]);

    if (!profileResult.data?.is_active) return <AccessPending />;
    userName = profileResult.data?.full_name ?? "Usuario";
    role = profileResult.data?.role === "owner" ? "Dueño" : "Cajero";
    isOwner = profileResult.data?.role === "owner";
    products = (productResult.data ?? []).map((product) => ({
      id: product.id, name: product.name, category: product.category,
      price: Number(product.price), detail: product.description ?? "",
    }));
    const orderResult = await supabase.rpc("list_pos_orders");
    const cashResult = await supabase.rpc("get_pos_cash_status");
    if (!cashResult.error) cashOpen = Boolean(cashResult.data?.open);
    if (productResult.error || profileResult.error || orderResult.error) loadError = "No se pudieron recuperar los datos del negocio. Revisa la configuración o actualiza los pedidos antes de vender.";
    if (orderResult.data) orders = (orderResult.data as DatabaseOrder[]).map((row) => fromDatabaseOrder(row, products));
  }

  return <PosShell initialProducts={products} initialOrders={orders} userName={userName} role={role} demo={!isSupabaseConfigured} loadError={loadError} isOwner={isOwner} initialCashOpen={cashOpen} />;
}
