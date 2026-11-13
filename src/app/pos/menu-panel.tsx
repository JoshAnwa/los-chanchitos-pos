"use client";

import { useEffect, useRef, useState } from "react";
import { Check, History, Pencil, Plus, RefreshCw, Search } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { getMenuDashboard, getPosMenu, saveMenuProduct } from "@/lib/menu-api";
import { productPrice, saleProducts, validProduct, type MenuDashboard, type MenuProduct, type ProductInput } from "@/lib/menu-management";
import { money, normalize, type Product } from "@/lib/pos";
import styles from "./menu-panel.module.css";

type Editor = { id: string; requestId: string; previous: MenuProduct | null; input: ProductInput };
const blank: ProductInput = { name: "", category: "Antojitos", description: "", price: "", active: true, reason: "" };

export function MenuPanel({ demo, isOwner, initialProducts, onChange, onBusyChange, onEditingChange }: {
  demo: boolean; isOwner: boolean; initialProducts: Product[]; onChange: (products: Product[]) => void;
  onBusyChange: (busy: boolean) => void; onEditingChange: (editing: boolean) => void;
}) {
  const [dashboard, setDashboard] = useState<MenuDashboard | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [attempted, setAttempted] = useState(false);
  const pending = useRef(false);
  const attemptedRef = useRef(false);
  const demoProducts: MenuProduct[] = initialProducts.map(p => ({ ...p, description: p.detail, is_active: true, version: 1, sort_order: 0 }));
  const products = dashboard?.products ?? (demo ? demoProducts : []);
  const visible = products.filter(p => (filter === "all" || p.is_active === (filter === "active")) && normalize(`${p.name} ${p.category}`).includes(normalize(query)));
  const priceChanged = Boolean(editor?.previous && productPrice(editor.input.price) !== editor.previous.price);
  const reasonRequired = Boolean(editor?.previous && (priceChanged || editor.input.active !== editor.previous.is_active));

  useEffect(() => {
    if (demo) return;
    let alive = true;
    (isOwner ? getMenuDashboard() : getPosMenu().then(products => ({ products, changes: [] }))).then(data => {
      if (alive) { setDashboard(data); onChange(saleProducts(data.products)); }
    }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : "No se pudo cargar el menú."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [demo, isOwner, onChange]);

  const editing = editor !== null;
  useEffect(() => { onEditingChange(editing); return () => onEditingChange(false); }, [editing, onEditingChange]);

  function edit(product: MenuProduct | null) {
    attemptedRef.current = false; setAttempted(false); setError(""); setNotice("");
    setEditor({ id: product?.id ?? crypto.randomUUID(), requestId: crypto.randomUUID(), previous: product,
      input: product ? { name: product.name, category: product.category, description: product.description, price: String(product.price), active: product.is_active, reason: "" } : { ...blank } });
  }
  function closeEditor() {
    if (pending.current) return;
    if (!window.confirm(attemptedRef.current ? "No se confirmó el intento. Al volver, actualiza y revisa el producto antes de crear otro. ¿Cerrar?" : "¿Cerrar sin guardar los cambios del producto?")) return;
    setEditor(null); setError("");
  }
  function change(key: keyof ProductInput, value: string | boolean) {
    if (pending.current || attemptedRef.current) return;
    setEditor(current => current ? { ...current, input: { ...current.input, [key]: value } } : current);
  }
  async function refresh(checkAttempt = false) {
    if (pending.current || demo) return;
    pending.current = true; setLoading(true); onBusyChange(true); setError("");
    try {
      const data = isOwner ? await getMenuDashboard() : { products: await getPosMenu(), changes: [] };
      setDashboard(data); onChange(saleProducts(data.products));
      if (checkAttempt) { setEditor(null); attemptedRef.current = false; setAttempted(false); }
      setNotice(checkAttempt ? "Menú actualizado. Revisa el producto en la lista antes de hacer otro cambio." : "Menú actualizado.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo actualizar el menú."); }
    finally { pending.current = false; setLoading(false); onBusyChange(false); }
  }
  async function save() {
    if (!editor || pending.current || !validProduct(editor.input, editor.previous)) return;
    pending.current = true; setBusy(true); onBusyChange(true); setError("");
    attemptedRef.current = true; setAttempted(true);
    try {
      const saved = await saveMenuProduct(editor.id, editor.previous?.version ?? 0, editor.requestId, editor.input);
      const next = { products: [...(dashboard?.products ?? []).filter(p => p.id !== saved.id), saved].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)), changes: dashboard?.changes ?? [] };
      setDashboard(next); onChange(saleProducts(next.products));
      // Confirmado antes de actualizar el historial: un fallo de lectura no convierte el guardado en un fallo.
      setEditor(null); attemptedRef.current = false; setAttempted(false);
      setNotice(`“${saved.name}” guardado. Los pedidos ya guardados conservan sus precios.`);
      try {
        const data = await getMenuDashboard(); setDashboard(data); onChange(saleProducts(data.products));
      } catch {
        setNotice(`“${saved.name}” guardado. Pulsa Actualizar menú para recargar el historial y el punto de venta.`);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo confirmar el cambio. Actualiza antes de cambiar los datos."); }
    finally { pending.current = false; setBusy(false); onBusyChange(false); }
  }

  return <section className={styles.root} aria-label="Administración del menú">
    <div className={styles.toolbar}><div><span className={styles.eyebrow}>EL MENÚ, AL DÍA</span><h2>{products.filter(p => p.is_active).length} productos disponibles</h2><p>{isOwner && !demo ? "Agrega productos o ajusta los precios. Cada cambio queda registrado." : "Consulta los productos. Sólo el Dueño puede cambiar el menú."}</p></div><div className={styles.actions}>
      {!demo && <button className={styles.secondary} disabled={loading || busy} onClick={() => refresh()}><RefreshCw size={17} />Actualizar menú</button>}
      {isOwner && !demo && <button className={styles.primary} disabled={!dashboard || loading || busy} onClick={() => edit(null)}><Plus size={18} />Agregar producto</button>}
    </div></div>
    {demo && <p className={styles.notice}>Demostración: los cambios del menú se hacen con la cuenta Dueño en el sistema conectado.</p>}
    {!editor && error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status"><Check size={16} />{notice}</p>}
    <div className={styles.filters}><label className={styles.search}><Search size={18} /><input aria-label="Buscar en el menú" placeholder="Buscar producto o categoría" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {isOwner && !demo && <div className={styles.segmented}>{[["active", "Disponibles"], ["inactive", "Desactivados"], ["all", "Todos"]].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>}</div>
    {loading ? <p className={styles.empty} role="status">Cargando menú…</p> : !visible.length ? <p className={styles.empty}>No hay productos en esta vista.</p> : <div className={styles.products}>{visible.map(p => <article key={p.id} className={!p.is_active ? styles.inactive : ""}>
      <div className={styles.productInfo}><span>{p.category}</span><h3>{p.name}</h3>{p.description && <p>{p.description}</p>}{!p.is_active && <small>Desactivado · no aparece al tomar pedidos</small>}</div>
      <strong className={styles.price}>{money.format(p.price)}</strong>{isOwner && !demo && <button className={styles.edit} disabled={busy || loading} onClick={() => edit(p)} aria-label={`Editar ${p.name}`}><Pencil size={16} /><span>Editar</span></button>}
    </article>)}</div>}
    {isOwner && !demo && <section className={styles.history}><h2><History size={20} />Últimos cambios</h2><p>Quién cambió el menú y por qué. Se muestran los 30 más recientes.</p>{!dashboard?.changes.length ? <p className={styles.empty}>Todavía no hay cambios registrados.</p> : <div className={styles.historyList}>{dashboard.changes.map(c => <article key={c.id}><div><strong>{c.after.name}</strong><span>{c.before ? c.before.price !== c.after.price ? `${money.format(c.before.price)} → ${money.format(c.after.price)}` : c.before.is_active !== c.after.is_active ? c.after.is_active ? "Producto reactivado" : "Producto desactivado" : "Datos actualizados" : "Producto agregado"}</span></div><p>{c.reason}</p><small>{c.actor_name} · {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(c.created_at))}</small></article>)}</div>}</section>}
    {editor && <Dialog title={editor.previous ? "Editar producto" : "Agregar producto"} onClose={closeEditor}><form className={styles.form} onSubmit={event => { event.preventDefault(); save(); }}>
      <p className={styles.hint}>Sólo el Dueño autoriza estos cambios. No se modifican ventas ni pedidos ya guardados.</p>
      <label>Nombre<input autoComplete="off" maxLength={80} value={editor.input.name} disabled={busy || attempted} onChange={e => change("name", e.target.value)} required /></label>
      <label>Categoría<input list="menu-categories" maxLength={40} value={editor.input.category} disabled={busy || attempted} onChange={e => change("category", e.target.value)} required /><datalist id="menu-categories">{[...new Set(products.map(p => p.category))].map(c => <option key={c} value={c} />)}</datalist></label>
      <label>Descripción <small>Opcional</small><input maxLength={160} value={editor.input.description} disabled={busy || attempted} onChange={e => change("description", e.target.value)} /></label>
      <label>Precio en pesos<input inputMode="decimal" placeholder="Ej. 25.00" value={editor.input.price} disabled={busy || attempted} onChange={e => change("price", e.target.value)} required />{editor.previous && <small>Precio actual: {money.format(editor.previous.price)}</small>}</label>
      <label className={styles.checkbox}><input type="checkbox" checked={editor.input.active} disabled={busy || attempted} onChange={e => change("active", e.target.checked)} />Disponible para vender</label>
      {editor.previous?.is_active && !editor.input.active && <p className={styles.hint}>Dejará de aparecer al tomar pedidos. Los pedidos ya guardados pueden cobrarse sin cambios; si necesitas modificarlos, reactiva primero el producto.</p>}
      <label>Motivo del cambio <small>{reasonRequired ? "Obligatorio: cambiaste precio o disponibilidad" : "Opcional"}</small><textarea rows={2} maxLength={300} value={editor.input.reason} disabled={busy || attempted} onChange={e => change("reason", e.target.value)} required={reasonRequired} minLength={reasonRequired ? 3 : undefined} placeholder="Ej. actualización de precio autorizada" /></label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {attempted && !busy && <p className={styles.hint}>Para evitar cambios duplicados, los datos del intento se conservan. Puedes reintentar exactamente lo mismo o actualizar y comprobar el resultado.</p>}
      <div className={styles.formActions}>{attempted && !busy ? <button type="button" className={styles.secondary} disabled={loading} onClick={() => refresh(true)}>Actualizar y comprobar</button> : <button type="button" className={styles.secondary} disabled={busy} onClick={closeEditor}>Volver</button>}<button className={styles.primary} disabled={busy || loading || !validProduct(editor.input, editor.previous)}>{busy ? "Guardando…" : attempted ? "Reintentar lo mismo" : priceChanged ? "Autorizar y guardar" : "Guardar producto"}</button></div>
    </form></Dialog>}
  </section>;
}
