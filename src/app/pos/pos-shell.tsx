"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, ArrowUpRight, Banknote, BookOpen, Check, ChevronRight,
  CircleHelp, ClipboardList, CookingPot, LayoutGrid, LogOut, Minus,
  Package, Plus, Printer, ReceiptText, Search, ShoppingBag,
  Trash2, UserRound, Utensils, WalletCards, X, House, ChartColumn, Store,
} from "lucide-react";
import { BrandPlaceholder } from "@/components/brand-placeholder";
import { LocalDate } from "@/components/local-date";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/dialog";
import { createClient } from "@/lib/supabase/client";
import { money, newDraft, normalize, orderTotal, paymentLabels, type DemoOrder, type Draft, type Payment, type Product } from "@/lib/pos";
import { PaymentDialog } from "./payment-dialog";
import { CashPanel } from "./cash-panel";
import { MenuPanel } from "./menu-panel";
import { InventoryPanel } from "./inventory-panel";
import { SalesPanel } from "./sales-panel";
import { BusinessPanel } from "./business-panel";
import { HomePanel } from "./home-panel";
import { getBusiness } from "@/lib/owner-api";
import type { BusinessSettings } from "@/lib/owner-data";
import { getPosMenu } from "@/lib/menu-api";
import { saleProducts } from "@/lib/menu-management";
import { getCashStatus } from "@/lib/cash-api";
import { cancelOrder, listOrders, orderKey, payOrder, restoreDrafts, saveOrder } from "@/lib/orders-api";
import styles from "./pos.module.css";

type View = "inicio" | "venta" | "pedidos" | "menu" | "caja" | "inventario" | "reportes" | "negocio";
type Receipt = { kind: "kitchen" | "paid"; label: string; lines: Draft["lines"]; notes: string; id?: string; payments?: Payment[] };
const navItems = [
  { id: "inicio", name: "Inicio", icon: House },
  { id: "venta", name: "Vender", icon: LayoutGrid },
  { id: "pedidos", name: "Pedidos", icon: ClipboardList },
  { id: "menu", name: "Productos", icon: BookOpen },
  { id: "caja", name: "Caja", icon: WalletCards },
  { id: "inventario", name: "Inventario", icon: Package },
  { id: "reportes", name: "Ventas", icon: ChartColumn },
  { id: "negocio", name: "Mi negocio", icon: Store },
] as const;
const viewTitles: Record<View, string> = { inicio: "Inicio", venta: "Tomar pedido", pedidos: "Pedidos", menu: "Productos", caja: "Caja", inventario: "Inventario", reportes: "Ventas", negocio: "Mi negocio" };

export function PosShell({ initialProducts, initialOrders = [], userName, role, demo, loadError, isOwner = false, initialCashOpen = null }: {
  initialProducts: Product[]; initialOrders?: DemoOrder[]; userName: string; role: string; demo: boolean; loadError?: string; isOwner?: boolean; initialCashOpen?: boolean | null;
}) {
  const router = useRouter();
  const nextDemoNumber = useRef(1);
  const mutationLock = useRef(false);
  const saveRequests = useRef<Record<string, { signature: string; id: string }>>({});
  const paymentRequests = useRef<Record<string, string>>({});
  const [view, setView] = useState<View>(isOwner || demo ? "inicio" : "venta");
  const [business, setBusiness] = useState<BusinessSettings | null>(null);
  const [offline,setOffline] = useState(false);
  useEffect(() => {
    if (!demo) getBusiness().then(setBusiness).catch(() => {});
    const update = () => setOffline(!navigator.onLine);
    update(); window.addEventListener("online",update);window.addEventListener("offline",update);
    return () => { window.removeEventListener("online",update);window.removeEventListener("offline",update); };
  }, [demo]);
  const [products, setProducts] = useState(initialProducts);
  const [menuEditing, setMenuEditing] = useState(false);
  const acceptMenu = useCallback((next: Product[]) => { setProducts(next); setCategory("Todos"); setQuery(""); }, []);
  const [category, setCategory] = useState("Todos");
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState("Mesa 1");
  const destination = activeKey.startsWith("takeaway:") ? "Para llevar" : activeKey;
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => demo ? {} : restoreDrafts(initialOrders));
  const [orders, setOrders] = useState<DemoOrder[]>(initialOrders);
  const [busy, setBusy] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [connectionError, setConnectionError] = useState(loadError);
  const [cancelReason, setCancelReason] = useState("");
  const [refreshConfirm, setRefreshConfirm] = useState(false);
  const [orderFilter, setOrderFilter] = useState("pedido");
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [help, setHelp] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [cashOpen, setCashOpen] = useState<boolean | null>(initialCashOpen);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  const hasUnsavedChanges = !demo && (menuEditing || Object.values(drafts).some((item) => item.dirty));
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges]);

  const draft = drafts[activeKey] ?? newDraft();
  const isSaved = !demo && (draft.version ?? 0) > 0;
  const total = orderTotal(draft.lines);
  const count = draft.lines.reduce((sum, line) => sum + line.quantity, 0);
  const categories = ["Todos", ...new Set(products.map((product) => product.category))];
  const visible = products.filter((product) => (category === "Todos" || product.category === category) && normalize(product.name).includes(normalize(query)));
  const pendingOrders = orders.filter((order) => order.status === "pedido");
  const displayedOrders = orders.filter((order) => order.status === orderFilter);
  const activeTables = [1, 2, 3, 4, 5].filter((number) => drafts[`Mesa ${number}`]?.lines.length).length;

  function updateDraft(next: Draft) {
    if (mutationLock.current) return;
    if (!demo && isSaved && next.lines.length === 0) { setClearConfirm(true); return; }
    const updated = demo ? next : { ...next, orderId: next.orderId ?? crypto.randomUUID(), dirty: true };
    setDrafts((current) => ({ ...current, [activeKey]: next.lines.length ? updated : newDraft() }));
    setOperationError("");
    if (demo && draft.orderId) {
      setOrders((current) => next.lines.length
        ? current.map((order) => order.id === draft.orderId && order.status === "pedido"
          ? { ...order, lines: next.lines, notes: next.notes, total: orderTotal(next.lines) } : order)
        : current.filter((order) => order.id !== draft.orderId || order.status === "pagado"));
    }
  }

  function selectDestination(label: string) {
    if (mutationLock.current) return;
    if (label === "Para llevar" && drafts["Para llevar"]?.version && !drafts["Para llevar"].dirty) {
      const saved = drafts["Para llevar"];
      setDrafts((current) => ({ ...current, [`takeaway:${saved.orderId}`]: saved, "Para llevar": newDraft() }));
    }
    setActiveKey(label);
    setOperationError("");
  }

  function add(product: Product) {
    const existing = draft.lines.find((line) => line.id === product.id);
    updateDraft({ ...draft, lines: existing
      ? draft.lines.map((line) => line.id === product.id ? { ...line, quantity: line.quantity + 1 } : line)
      : [...draft.lines, { ...product, quantity: 1 }] });
  }

  function quantity(id: string, delta: number) {
    updateDraft({ ...draft, lines: draft.lines.map((line) => line.id === id ? { ...line, quantity: line.quantity + delta } : line).filter((line) => line.quantity > 0) });
  }

  function loadExample() {
    if (draft.lines.length) { setMessage("El pedido ya tiene productos. Puedes agregar más desde el menú."); return; }
    const exampleIds = ["tacos", "pozole", "agua-litro"];
    updateDraft({ ...draft, lines: products.filter((product) => exampleIds.includes(product.id)).map((product) => ({ ...product, quantity: product.id === "tacos" ? 2 : 1 })) });
    setMessage("Ejemplo cargado. Puedes cambiar cantidades o quitar productos.");
  }

  function saveDemoOrder() {
    const id = draft.orderId ?? `D-${String(nextDemoNumber.current++).padStart(3, "0")}`;
    const order: DemoOrder = { ...draft, id, orderId: id, label: destination, status: "pedido", total,
      time: new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", timeZone: "America/Mexico_City" }).format(new Date()) };
    setOrders((current) => [order, ...current.filter((item) => item.id !== id)]);
    updateDraft({ ...draft, orderId: id });
    setReceipt(null);
    setMessage("Pedido de prueba guardado. Lo encuentras en Pedidos.");
  }

  function applySaved(order: DemoOrder) {
    const key = orderKey(order);
    setOrders((current) => [order, ...current.filter((item) => item.id !== order.id)]);
    setDrafts((current) => {
      const next = { ...current };
      if (key !== activeKey) delete next[activeKey];
      next[key] = { lines: order.lines, notes: order.notes, orderId: order.id, number: order.number, version: order.version, dirty: false };
      return next;
    });
    setActiveKey(key);
  }

  async function saveCurrent() {
    if (!draft.lines.length) throw new Error("Agrega al menos un producto antes de guardar.");
    const previous = orders.find((order) => order.id === draft.orderId);
    if (isSaved && !draft.dirty && previous) return previous;
    const id = draft.orderId!;
    const signature = JSON.stringify([draft.version ?? 0, draft.lines.map((line) => [line.id, line.quantity]), draft.notes, destination]);
    if (saveRequests.current[id]?.signature !== signature) saveRequests.current[id] = { signature, id: crypto.randomUUID() };
    const saved = await saveOrder(draft, destination, saveRequests.current[id].id, products);
    applySaved(saved);
    return saved;
  }

  async function saveCurrentFromButton() {
    if (demo) { saveDemoOrder(); return; }
    if (mutationLock.current || connectionError) return;
    mutationLock.current = true; setBusy(true); setOperationError("");
    try {
      await saveCurrent(); setReceipt(null); setMessage("Pedido guardado. Puedes recuperarlo al volver a entrar.");
    } catch (error) { setOperationError(error instanceof Error ? error.message : "No se pudo guardar el pedido."); }
    finally { mutationLock.current = false; setBusy(false); }
  }

  async function refreshOrders() {
    if (mutationLock.current || demo) return;
    mutationLock.current = true; setBusy(true);
    try {
      const [menu, cash] = await Promise.all([getPosMenu(), getCashStatus()]);
      const currentProducts = saleProducts(menu);
      const saved = await listOrders(currentProducts);
      acceptMenu(currentProducts);
      setCashOpen(cash.open);
      setOrders(saved); setDrafts(restoreDrafts(saved)); setActiveKey("Mesa 1"); setConnectionError(undefined);
      setOperationError(""); setRefreshConfirm(false); setMessage("Pedidos actualizados.");
    } catch (error) { setOperationError(error instanceof Error ? error.message : "No se pudieron actualizar los pedidos."); }
    finally { mutationLock.current = false; setBusy(false); }
  }

  async function refreshMenu() {
    if (mutationLock.current || demo) return;
    mutationLock.current = true; setBusy(true);
    try {
      acceptMenu(saleProducts(await getPosMenu())); setOperationError("");
      setMessage("Menú actualizado sin borrar tu pedido. Los precios nuevos se comprueban al guardar.");
    } catch (error) { setOperationError(error instanceof Error ? error.message : "No se pudo actualizar el menú."); }
    finally { mutationLock.current = false; setBusy(false); }
  }

  async function clearOrder() {
    if (!isSaved) {
      updateDraft({ ...draft, lines: [], notes: "" }); setClearConfirm(false); return;
    }
    if (mutationLock.current) return;
    if (!isOwner) { setOperationError("Sólo el dueño puede cancelar un pedido guardado."); return; }
    mutationLock.current = true; setBusy(true);
    try {
      await cancelOrder(draft, cancelReason);
      setDrafts((current) => ({ ...current, [activeKey]: newDraft() }));
      setOrders((current) => current.filter((order) => order.id !== draft.orderId));
      setClearConfirm(false); setCancelReason(""); setOperationError(""); setMessage("Pedido cancelado. Se conservó el motivo en el registro.");
    } catch (error) { setOperationError(error instanceof Error ? error.message : "No se pudo cancelar el pedido."); }
    finally { mutationLock.current = false; setBusy(false); }
  }

  async function confirmPayment(payments: Payment[]) {
    if (mutationLock.current) return "Espera a que termine la operación actual.";
    if (connectionError) return "Actualiza los pedidos antes de cobrar.";
    if (!demo && cashOpen !== true) return "Pide al Dueño que abra la caja y pulsa Actualizar pedidos antes de cobrar.";
    if (!demo) {
      mutationLock.current = true; setBusy(true);
      try {
        const saved = await saveCurrent();
        if (Math.abs(saved.total - payments.reduce((sum, payment) => sum + payment.amount, 0)) > .001) {
          return "Se actualizaron los precios del pedido. Revisa el nuevo total y confirma los importes.";
        }
        paymentRequests.current[saved.id] ??= crypto.randomUUID();
        const paid = await payOrder(saved, payments, paymentRequests.current[saved.id], products);
        setOrders((current) => [paid, ...current.filter((item) => item.id !== paid.id)]);
        setDrafts((current) => {
          const next = { ...current };
          for (const [key, item] of Object.entries(next)) {
            if (item.orderId === paid.id || key === activeKey) delete next[key];
          }
          return next;
        });
        setActiveKey(paid.label === "Para llevar" ? "Para llevar" : paid.label);
        setReceipt({ kind: "paid", label: paid.label, lines: paid.lines, notes: paid.notes, id: paid.number, payments: paid.payments });
        setPaying(false); setCartOpen(false); setOperationError("");
      } catch (error) { return error instanceof Error ? error.message : "No se pudo confirmar el cobro."; }
      finally { mutationLock.current = false; setBusy(false); }
      return;
    }
    const id = draft.orderId ?? `D-${String(nextDemoNumber.current++).padStart(3, "0")}`;
    const order: DemoOrder = { ...draft, id, orderId: id, label: destination, status: "pagado", total, payments,
      time: new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit", timeZone: "America/Mexico_City" }).format(new Date()) };
    setOrders((current) => [order, ...current.filter((item) => item.id !== id)]);
    setReceipt({ kind: "paid", label: destination, lines: draft.lines, notes: draft.notes, id, payments });
    updateDraft(newDraft());
    setPaying(false);
    setCartOpen(false);
  }

  function resume(order: DemoOrder) {
    const key = demo ? order.label : orderKey(order);
    setActiveKey(key);
    setDrafts((current) => ({ ...current, [key]: current[key]?.dirty ? current[key] : {
      lines: order.lines, notes: order.notes, orderId: order.id, version: order.version, number: order.number, dirty: false,
    } }));
    setView("venta");
    setCartOpen(true);
  }

  function navigate(next: View) {
    if (mutationLock.current) return;
    if (next !== view && menuEditing && !window.confirm("Hay cambios sin guardar en esta pantalla. ¿Salir y descartarlos?")) return;
    setView(next); setCartOpen(false);
  }

  async function signOut() {
    if (mutationLock.current) return;
    if (hasUnsavedChanges && !window.confirm("Hay cambios sin guardar. ¿Quieres salir y descartarlos?")) return;
    if (demo) { router.push("/login"); return; }
    const { error } = await createClient().auth.signOut();
    if (error) setMessage("No se pudo salir. Intenta de nuevo.");
    else { router.push("/login"); router.refresh(); }
  }

  return (
    <main className={styles.app}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}><BrandPlaceholder /><div><strong>Los Chanchitos</strong><small>Punto de venta</small></div></div>
        <nav aria-label="Navegación principal">
          {navItems.filter((item) => demo || isOwner || !["caja", "inventario", "reportes", "negocio"].includes(item.id)).map(({ id, name, icon: Icon }) => <button key={id} disabled={busy} onClick={() => navigate(id)} aria-current={view === id ? "page" : undefined} className={view === id ? styles.activeNav : ""}>
            <Icon size={20} /><span>{name}</span>{id === "pedidos" && pendingOrders.length > 0 && <b>{pendingOrders.length}</b>}
          </button>)}
        </nav>
        <div className={styles.sidebarBottom}>
          <button onClick={() => setHelp(true)} aria-label="Cómo usarlo" className={styles.helpButton}><CircleHelp size={19} /><span>Cómo usarlo</span></button>
          <div className={styles.user}><span><UserRound size={20} /></span><div><strong>{userName}</strong><small>{role}</small></div><button onClick={signOut} aria-label="Salir del sistema"><LogOut size={18} /></button></div>
        </div>
      </aside>

      <section className={styles.workspace}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}><span>Los Chanchitos</span><ChevronRight size={14} /><strong>{viewTitles[view]}</strong></div>
          <div className={styles.topActions}><span className={styles.date}><LocalDate /></span><span className={styles.demoBadge}><i />{demo ? "Demostración" : "Uso interno"}</span><button className={styles.mobileHeaderButton} aria-label="Cómo usarlo" onClick={() => setHelp(true)}><CircleHelp size={18} /></button><button className={styles.mobileHeaderButton} aria-label="Salir del sistema" onClick={signOut}><LogOut size={18} /></button></div>
        </header>
        <div className={`${styles.pageHeading} ${view === "venta" ? styles.sellingHeading : ""}`}>
          <h1>{viewTitles[view]}</h1>
          {demo && view === "venta" && <button className={styles.outlineButton} onClick={loadExample}>Probar con un ejemplo<ArrowUpRight size={17} /></button>}
        </div>
        {connectionError && <p className={styles.loadError} role="alert">{connectionError}</p>}
        {offline && <p className={styles.loadError} role="alert">No hay conexión. No confirmes cobros ni salgas con cambios sin guardar. La app necesita internet para guardar y consultar datos.</p>}
        {!demo && view === "venta" && cashOpen !== true && <div className={styles.cashNotice} role="status"><span>{cashOpen === false ? "Caja cerrada. Ábrela para cobrar." : "Caja sin confirmar. Actualiza los pedidos antes de cobrar."}</span>{isOwner && <button disabled={busy} onClick={() => navigate("caja")}>Ir a caja</button>}<button disabled={busy} onClick={() => hasUnsavedChanges ? setRefreshConfirm(true) : refreshOrders()}>Actualizar pedidos</button></div>}
        {operationError && view !== "venta" && <p className={styles.loadError} role="alert">{operationError}</p>}

        {view === "venta" ? <div className={styles.sellingLayout}>
          <section className={`${styles.catalog} ${cartOpen ? styles.catalogHiddenMobile : ""}`} aria-label="Menú para agregar productos">
            <div className={styles.destinationHeading}><span>Mesas y para llevar</span><small>{activeTables} de 5 mesas con pedido</small></div>
            <div className={styles.destinations} aria-label="Elegir mesa o para llevar">
              {["Mesa 1", "Mesa 2", "Mesa 3", "Mesa 4", "Mesa 5", "Para llevar"].map((label) => <button key={label} disabled={busy} aria-pressed={destination === label} className={destination === label ? styles.destinationActive : ""} onClick={() => selectDestination(label)}>
                {label === "Para llevar" ? <ShoppingBag size={19} /> : <Utensils size={19} />}<strong>{label}</strong>
                <small>{drafts[label]?.lines.length ? money.format(orderTotal(drafts[label].lines)) : label === "Para llevar" ? "Mostrador" : "Sin pedido"}</small>
              </button>)}
            </div>
            <div className={styles.catalogHeading}><div><h2>Menú</h2><span>{products.length} productos</span></div><label className={styles.search}><Search size={18} /><input aria-label="Buscar producto" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto" />{query && <button aria-label="Borrar búsqueda" onClick={() => setQuery("")}><X size={16} /></button>}</label></div>
            <div className={styles.categories} aria-label="Categorías del menú">
              {categories.map((name) => <button key={name} aria-pressed={category === name} onClick={() => setCategory(name)} className={category === name ? styles.categoryActive : ""}>{name}</button>)}
            </div>
            <div className={styles.results}><span>{category === "Todos" ? "Todos los productos" : category}</span>{demo ? <small>Toca para agregar al pedido</small> : <button className={styles.outlineButton} disabled={busy} onClick={refreshMenu}>Actualizar menú</button>}</div>
            <div className={styles.products}>
              {visible.map((product) => { const inCart = draft.lines.find((line) => line.id === product.id)?.quantity; return (
                <button className={styles.product} key={product.id} disabled={busy} onClick={() => add(product)} aria-label={`Agregar ${product.name}, ${money.format(product.price)}`}>
                  <span className={styles.productName}><strong>{product.name}</strong>{inCart && <small className={styles.inCart}>{inCart} en pedido</small>}</span>
                  {product.detail && <small>{product.detail}</small>}
                  <span className={styles.productBottom}><b>{money.format(product.price)}</b><span aria-hidden="true"><Plus size={19} /></span></span>
                </button>
              ); })}
            </div>
            {visible.length === 0 && <div className={styles.empty}><Search size={30} /><h3>No encontramos productos</h3><p>Prueba otro nombre o cambia la categoría.</p><button className={styles.outlineButton} onClick={() => { setQuery(""); setCategory("Todos"); }}>Ver todo el menú</button></div>}
          </section>

          <aside className={`${styles.ticket} ${cartOpen ? styles.ticketMobileOpen : ""}`} aria-label="Pedido actual">
            <div className={styles.ticketHead}><div><span>PEDIDO ACTUAL</span><h2>{destination}</h2></div><span className={styles.ticketIcon}>{destination === "Para llevar" ? <ShoppingBag size={23} /> : <Utensils size={23} />}</span><button className={styles.closeCart} onClick={() => setCartOpen(false)} aria-label="Volver al menú"><X size={22} /></button></div>
            <div className={styles.ticketSubhead}><span>{draft.orderId && (demo || isSaved) ? `Pedido ${draft.number ?? draft.orderId}` : "Nuevo pedido"}</span><span>{count} {count === 1 ? "artículo" : "artículos"}</span></div>
            {operationError && <p className={`${styles.error} ${styles.ticketError}`} role="alert">{operationError}</p>}
            <div className={styles.cartLines}>
              {draft.lines.length === 0 ? <div className={styles.emptyCart}><h3>Sin productos</h3><p>Agrega productos del menú.</p></div> : draft.lines.map((line) => <div className={styles.cartLine} key={line.id}>
                <div className={styles.cartTop}><strong>{line.name}</strong><b>{money.format(line.price * line.quantity)}</b></div>
                <small>{money.format(line.price)} cada uno</small>
                <div className={styles.qty}><button disabled={busy} onClick={() => quantity(line.id, -1)} aria-label={`Quitar uno de ${line.name}`}><Minus size={16} /></button><span>{line.quantity}</span><button disabled={busy} onClick={() => quantity(line.id, 1)} aria-label={`Agregar uno de ${line.name}`}><Plus size={16} /></button><button className={styles.remove} disabled={busy} onClick={() => updateDraft({ ...draft, lines: draft.lines.filter((item) => item.id !== line.id) })} aria-label={`Eliminar ${line.name}`}><Trash2 size={16} /></button></div>
              </div>)}
            </div>
            {draft.lines.length > 0 && <details className={styles.notes}><summary>Nota para cocina <span>{draft.notes ? "Agregada" : "Opcional"}</span></summary><label><span className="sr-only">Nota para cocina</span><textarea disabled={busy} maxLength={300} value={draft.notes} onChange={(event) => updateDraft({ ...draft, notes: event.target.value })} placeholder="Ej. sin cebolla, salsa aparte…" rows={2} /></label></details>}
            <div className={styles.ticketBottom}>
              <div className={styles.total}><span>Total del pedido</span><strong>{money.format(total)}</strong></div>
              <button className={styles.primaryButton} disabled={!count || busy || Boolean(connectionError) || !demo && cashOpen !== true} onClick={() => setPaying(true)}><Banknote size={20} />Cobrar<ArrowRight size={19} /></button>
              {!demo && <button className={styles.secondaryButton} disabled={!count || busy || Boolean(connectionError) || isSaved && !draft.dirty} onClick={saveCurrentFromButton}><Check size={18} />{busy ? "Guardando…" : isSaved && !draft.dirty ? "Pedido guardado" : "Guardar pedido"}</button>}
              <button className={styles.secondaryButton} disabled={!count || busy} onClick={() => setReceipt({ kind: "kitchen", label: destination, lines: draft.lines, notes: draft.notes, id: draft.number ?? (demo ? draft.orderId : undefined) })}><CookingPot size={19} />Ver comanda</button>
              <button className={styles.clearButton} disabled={!count || busy} onClick={() => { setCancelReason(""); setClearConfirm(true); }}><Trash2 size={15} />{isSaved ? "Cancelar pedido" : "Vaciar pedido"}</button>
              <p className={styles.footnote}>{demo ? "Pedido de prueba · sin venta real" : draft.dirty ? "Cambios sin guardar · guarda antes de salir" : isSaved ? "Guardado en la base de datos" : "Agrega productos para comenzar"}</p>
            </div>
          </aside>
        </div> : <div className={styles.otherPage}>
          {view === "inicio" && <HomePanel isOwner={isOwner || demo} cashOpen={cashOpen} pendingCount={pendingOrders.length} onNavigate={navigate} />}
          {view === "pedidos" && <>
            <div className={styles.sectionToolbar}><div className={styles.segmented}>{["pedido", "pagado"].map((status) => <button key={status} aria-pressed={orderFilter === status} className={orderFilter === status ? styles.segmentedActive : ""} onClick={() => setOrderFilter(status)}>{status === "pedido" ? "Pedidos" : "Pagados"}<span>{orders.filter((order) => order.status === status).length}</span></button>)}</div>{!demo && <button className={styles.outlineButton} disabled={busy} onClick={() => hasUnsavedChanges ? setRefreshConfirm(true) : refreshOrders()}>Actualizar pedidos</button>}<button className={styles.outlineButton} disabled={busy} onClick={() => navigate("venta")}><Plus size={17} />Tomar pedido</button></div>
            <div className={styles.sessionNote}>{demo ? "Los pedidos de prueba se conservan mientras esta página esté abierta. Al recargar, la demostración comienza de nuevo." : "Los pedidos guardados se recuperan al recargar. Pulsa Actualizar pedidos para consultar cambios de otros equipos."}</div>
            {displayedOrders.length ? <div className={styles.orderCards}>{displayedOrders.map((order) => <article key={order.id} className={styles.orderCard}><div><span className={styles.orderStatus}>{order.status === "pagado" ? <Check size={14} /> : <ReceiptText size={14} />}{order.status === "pagado" ? "Pagado" : "Pedido"}</span><small>{order.time}</small></div><h2>{order.label}</h2><p>{order.lines.map((line) => `${line.quantity} ${line.name}`).join(" · ")}</p><footer><b>{money.format(order.total)}</b><button className={styles.outlineButton} disabled={busy} onClick={() => order.status === "pedido" ? resume(order) : setReceipt({ kind: "paid", label: order.label, lines: order.lines, notes: order.notes, id: order.number ?? order.id, payments: order.payments })}>{order.status === "pedido" ? "Abrir pedido" : "Ver ticket"}<ArrowRight size={16} /></button></footer></article>)}</div> : <div className={styles.empty}><ClipboardList size={37} strokeWidth={1.3} /><h3>{orderFilter === "pagado" ? "Todavía no hay pedidos pagados" : "Todavía no hay pedidos guardados"}</h3><p>Comienza en Punto de venta. Desde ahí puedes revisar la comanda o cobrar.</p><button className={styles.primaryButton} onClick={() => navigate("venta")}>Ir a punto de venta<ArrowRight size={18} /></button></div>}
          </>}
          {view === "caja" && <CashPanel demo={demo} onChange={setCashOpen} onBusyChange={value => { mutationLock.current = value; setBusy(value); }} />}
          {view === "menu" && <MenuPanel demo={demo} isOwner={isOwner} initialProducts={products} onChange={acceptMenu} onBusyChange={value => { mutationLock.current = value; setBusy(value); }} onEditingChange={setMenuEditing} />}
          {view === "inventario" && (isOwner || demo) && <InventoryPanel demo={demo} products={products} onBusyChange={value => { mutationLock.current = value; setBusy(value); }} onEditingChange={setMenuEditing} />}
          {view === "reportes" && (isOwner || demo) && <SalesPanel demo={demo} />}
          {view === "negocio" && (isOwner || demo) && <BusinessPanel demo={demo} onChange={setBusiness} onBusyChange={value => { mutationLock.current = value; setBusy(value); }} onEditingChange={setMenuEditing} />}
        </div>}
        {view === "venta" && <button className={styles.mobileCart} onClick={() => setCartOpen((current) => !current)}><span><ReceiptText size={20} />{cartOpen ? "Volver al menú" : `Ver pedido · ${count} ${count === 1 ? "artículo" : "artículos"}`}</span><b>{money.format(total)}</b></button>}
      </section>

      {paying && <PaymentDialog total={total} label={destination} demo={demo} onClose={() => setPaying(false)} onConfirm={confirmPayment} />}
      {receipt && <Dialog title={receipt.kind === "kitchen" ? "Comanda para cocina" : demo ? "Pago de prueba listo" : "Pedido pagado"} onClose={() => setReceipt(null)}>
        <p className={styles.receiptHelp}>{receipt.kind === "kitchen" ? "Revisa los productos y la nota antes de imprimir." : demo ? "Así se verá el ticket. No se ha registrado una venta real." : "El cobro se guardó correctamente."}</p>
        <div className={styles.printArea}>
          <div className={styles.receiptBrand}><BrandPlaceholder /><strong>Los Chanchitos</strong>{business && <small>{business.name}{business.address ? ` · ${business.address}` : ""}</small>}<span>{receipt.kind === "kitchen" ? "COMANDA DE COCINA" : "TICKET DE VENTA"}</span>{demo && <small>DEMOSTRACIÓN · SIN VALIDEZ DE VENTA</small>}</div>
          <div className={styles.receiptMeta}><b>{receipt.label}</b><span>{receipt.id ?? "Pedido nuevo"}</span></div>
          {receipt.lines.map((line) => <div className={styles.receiptLine} key={line.id}><span>{line.quantity} × {line.name}</span>{receipt.kind === "paid" && <b>{money.format(line.price * line.quantity)}</b>}</div>)}
          {receipt.notes && <p className={styles.receiptNote}><strong>Nota:</strong> {receipt.notes}</p>}
          {receipt.kind === "paid" && <><div className={styles.receiptTotal}><b>Total</b><b>{money.format(orderTotal(receipt.lines))}</b></div>{receipt.payments?.map((payment) => <div className={styles.receiptLine} key={payment.method}><span>{paymentLabels[payment.method]}</span><span>{money.format(payment.amount)}</span></div>)}<p className={styles.thanks}>Gracias por tu visita.</p></>}
        </div>
        <div className={styles.receiptActions}><button className={styles.primaryButton} disabled={busy} onClick={() => window.print()}><Printer size={19} />{receipt.kind === "kitchen" ? "Imprimir comanda" : "Imprimir ticket"}</button>{receipt.kind === "kitchen" ? <button className={styles.secondaryButton} disabled={busy || Boolean(connectionError)} onClick={saveCurrentFromButton}>{busy ? "Guardando…" : demo ? "Guardar pedido de prueba" : "Guardar pedido"}</button> : <button className={styles.secondaryButton} onClick={() => setReceipt(null)}>Continuar</button>}</div>
        {operationError && <p className={styles.error} role="alert">{operationError}</p>}
        <p className={styles.footnote}>{receipt.kind === "kitchen" ? "Imprime desde el navegador. Envío automático a cocina: próximamente." : "Selecciona la impresora en el diálogo del navegador."}</p>
      </Dialog>}
      {clearConfirm && <Dialog title={isSaved ? "¿Cancelar este pedido?" : "¿Vaciar este pedido?"} onClose={() => { if (!busy) setClearConfirm(false); }}>
        <p className={styles.receiptHelp}>{isSaved ? isOwner ? "El pedido quedará registrado como cancelado. Escribe el motivo." : "Pide al dueño que cancele este pedido. Tu usuario no tiene permiso para hacerlo." : `Se quitarán los productos de ${destination.toLowerCase()}.`}</p>
        {isSaved && isOwner && <label className={styles.field}>Motivo de cancelación<input value={cancelReason} maxLength={300} onChange={(event) => setCancelReason(event.target.value)} placeholder="Ej. el cliente cambió de pedido" /></label>}
        {operationError && <p className={styles.error} role="alert">{operationError}</p>}
        <div className={styles.confirmButtons}><button className={styles.outlineButton} disabled={busy} onClick={() => setClearConfirm(false)}>Conservar pedido</button><button className={styles.dangerButton} disabled={busy || isSaved && (!isOwner || cancelReason.trim().length < 3)} onClick={clearOrder}>{busy ? "Guardando…" : isSaved ? "Cancelar pedido" : "Vaciar pedido"}</button></div>
      </Dialog>}
      {refreshConfirm && <Dialog title="Hay cambios sin guardar" onClose={() => setRefreshConfirm(false)}><p className={styles.receiptHelp}>Actualizar cargará los pedidos guardados en la base de datos y descartará los cambios que todavía no guardaste en esta pantalla. Puedes volver y anotar o guardar tus cambios primero.</p><div className={styles.confirmButtons}><button className={styles.outlineButton} disabled={busy} onClick={() => setRefreshConfirm(false)}>Volver</button><button className={styles.dangerButton} disabled={busy} onClick={refreshOrders}>Descartar y actualizar</button></div></Dialog>}
      {help && <Dialog title="Un pedido en tres pasos" onClose={() => setHelp(false)}><ol className={styles.helpSteps}><li><strong>Elige mesa o para llevar</strong><span>Cada mesa tiene su propio pedido.</span></li><li><strong>Agrega los productos</strong><span>Toca el menú, ajusta cantidades y deja una nota si hace falta.</span></li><li><strong>Revisa la comanda y cobra</strong><span>Puedes imprimir para cocina y después elegir cómo te pagan.</span></li></ol><p className={styles.sessionNote}>{demo ? "Estás en una demostración. Los datos de prueba se reinician al recargar." : "El Dueño debe abrir la caja antes del primer cobro. Guarda los pedidos antes de salir; para ver cambios de otros equipos, pulsa Actualizar pedidos."}</p><button className={styles.primaryButton} onClick={() => setHelp(false)}>Entendido<Check size={18} /></button></Dialog>}
      <div className={styles.toastRegion} role="status" aria-live="polite">{message && <div className={styles.toast}><Check size={18} />{message}</div>}</div>
    </main>
  );
}
