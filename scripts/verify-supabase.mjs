import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

// Sólo lecturas anónimas. No crea cuentas, pedidos ni sesiones administrativas.
try {
  const target = process.argv.find((value) => value.startsWith("--project-ref="))?.slice("--project-ref=".length);
  assert.match(target ?? "", /^[a-z0-9]{20}$/, "Indica explícitamente --project-ref=REFERENCIA_DEL_PROYECTO_NUEVO.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert.equal(url, `https://${target}.supabase.co`, "La URL configurada no coincide con el destino autorizado. No se realizaron solicitudes.");
  assert.ok(key?.startsWith("sb_publishable_"), "Usa únicamente la llave publicable del proyecto; no una llave secreta.");

  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey:key }, signal:AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, "No se pudo leer la configuración pública de Auth.");
  const settings = await response.json();
  assert.equal(settings.disable_signup, true, "El registro público debe estar desactivado.");

  const client = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const products = await client.from("products").select("id").limit(1);
  assert.equal(products.error?.code,"42501","El catálogo debe rechazar las lecturas sin sesión de personal.");
  const orders = await client.rpc("list_pos_orders");
  assert.equal(orders.error?.code,"42501","Los pedidos deben rechazar llamadas sin sesión de personal.");
  for (const name of ["get_pos_cash_status","get_cash_dashboard","list_pos_products","get_menu_dashboard","get_inventory_dashboard","get_business_settings"]) {
    const result=await client.rpc(name).abortSignal(AbortSignal.timeout(15000));
    assert.equal(result.error?.code,"42501",`${name} debe rechazar llamadas sin sesión de personal.`);
  }
  const changes = await client.from("product_changes").select("id").limit(1).abortSignal(AbortSignal.timeout(15000));
  assert.equal(changes.error?.code,"42501","El historial del menú debe rechazar lecturas sin sesión de personal.");
  const inventory = await client.from("inventory_actions").select("request_id").limit(1).abortSignal(AbortSignal.timeout(15000));
  assert.equal(inventory.error?.code,"42501","La auditoría de inventario debe rechazar lecturas sin sesión.");
  const sales=await client.rpc("get_sales_report",{p_from:"2026-10-01",p_to:"2026-10-26"}).abortSignal(AbortSignal.timeout(15000));
  assert.equal(sales.error?.code,"42501","Las ventas deben rechazar llamadas sin sesión.");

  console.log(`✓ Proyecto ${target}: conexión pública válida, registro cerrado y datos no accesibles sin sesión.`);
  console.log("Sólo se realizaron lecturas. Esta comprobación no sustituye las pruebas de ingreso y operación con cuentas reales de personal.");
} catch (error) {
  console.error(error instanceof assert.AssertionError ? error.message.split("\n")[0] : "No se pudo completar la comprobación de conexión. Revisa internet y la configuración del proyecto nuevo.");
  process.exitCode=1;
}
