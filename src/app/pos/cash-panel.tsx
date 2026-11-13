"use client";

import { useEffect, useRef, useState } from "react";
import { Banknote, Check, RefreshCw, WalletCards } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { money, roundMoney } from "@/lib/pos";
import { cashAmount, type CashDashboard, type CashSession } from "@/lib/cash";
import { closeCash, getCashDashboard, openCash } from "@/lib/cash-api";
import styles from "./cash-panel.module.css";

const when = (date: string) => new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Mexico_City" }).format(new Date(date));

export function CashPanel({ demo, onChange, onBusyChange }: { demo: boolean; onChange: (open: boolean) => void; onBusyChange: (busy: boolean) => void }) {
  const [data, setData] = useState<CashDashboard | null>(null);
  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [closing, setClosing] = useState<CashSession | null>(null);
  const [detail, setDetail] = useState<CashSession | null>(null);
  const lock = useRef(false);
  const openingIntent = useRef<{ id: string; amount: number } | null>(null);
  const closingIntent = useRef<{ session: CashSession; amount: number; notes: string } | null>(null);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    getCashDashboard().then(result => { if (!cancelled) { setData(result); onChange(Boolean(result.current)); } }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "No se pudo consultar la caja.");
    });
    return () => { cancelled = true; };
  }, [demo, onChange]);

  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setPending(true); onBusyChange(true); setError(""); setNotice("");
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No pudimos confirmar la caja."); }
    finally { lock.current = false; setPending(false); onBusyChange(false); }
  }

  async function refresh() {
    await run(async () => {
      const result = await getCashDashboard();
      setData(result); onChange(Boolean(result.current));
      openingIntent.current = null; closingIntent.current = null;
      setNotice("Caja actualizada.");
    });
  }

  function start(event: React.FormEvent) {
    event.preventDefault();
    const amount = cashAmount(opening);
    if (amount === null) return;
    if (openingIntent.current && openingIntent.current.amount !== amount) {
      setError("Primero pulsa Actualizar caja para confirmar el intento anterior."); return;
    }
    openingIntent.current ??= { id: crypto.randomUUID(), amount };
    const intent = openingIntent.current;
    void run(async () => {
      const session = await openCash(intent.id, intent.amount);
      setData(current => ({ current: session.status === "open" ? session : null, history: current?.history ?? [] }));
      onChange(session.status === "open"); openingIntent.current = null; setOpening("");
      setNotice(session.status === "open" ? "Caja abierta. El personal ya puede cobrar." : "Esta apertura ya tiene un corte. Actualiza antes de abrir otra caja.");
    });
  }

  function finish(event: React.FormEvent) {
    event.preventDefault();
    const amount = cashAmount(counted);
    if (!closing || amount === null) return;
    if (closingIntent.current && (closingIntent.current.amount !== amount || closingIntent.current.notes !== notes)) {
      setError("Reintenta con los mismos datos o vuelve y actualiza la caja para confirmar el cierre anterior."); return;
    }
    closingIntent.current ??= { session: closing, amount, notes };
    const intent = closingIntent.current;
    void run(async () => {
      const session = await closeCash(intent.session, intent.amount, intent.notes);
      setData(current => ({ current: null, history: [session, ...(current?.history ?? []).filter(row => row.id !== session.id)].slice(0, 30) }));
      onChange(false); closingIntent.current = null; setClosing(null); setDetail(session); setCounted(""); setNotes("");
      setNotice("Corte guardado. Para cobrar de nuevo hay que abrir otra caja.");
    });
  }

  if (demo) return <div className={styles.panel}><h2>Caja del negocio</h2><p>La caja requiere una cuenta Dueño y la base de datos conectada. La demostración no registra aperturas ni cortes.</p></div>;
  const current = data?.current;
  const closingAmount = cashAmount(counted);
  const difference = closing && closingAmount !== null ? roundMoney(closingAmount - closing.expected_amount) : null;

  return <section className={styles.root} aria-label="Control de caja">
    <div className={styles.toolbar}><span>Sólo el Dueño abre y cierra · Una caja compartida por sucursal</span><button disabled={pending} className={styles.secondary} onClick={refresh}><RefreshCw size={17} />Actualizar caja</button></div>
    {error && !closing && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!data ? <p>{error ? "Revisa la conexión y vuelve a consultar." : "Consultando la caja…"}</p> : current ? <div className={styles.panel}>
      <span className={styles.badge}>Caja abierta</span><h2>Todo listo para cobrar</h2>
      <p>Abrió {current.opened_by_name} · {when(current.opened_at)}</p>
      <div className={styles.metrics}><Metric label="Fondo inicial" amount={current.opening_amount} /><Metric label="Ventas cobradas" amount={current.total_sales} /><Metric label="Efectivo esperado" amount={current.expected_amount} primary /></div>
      <Breakdown session={current} />
      <p className={styles.hint}>Efectivo esperado = fondo inicial + ventas en efectivo. Tarjeta y transferencia no se cuentan dentro del cajón. No se incluyen gastos ni retiros.</p>
      <button disabled={pending} className={styles.primary} onClick={() => { setError(""); setCounted(""); setNotes(""); setClosing(current); }}><Check size={18} />Hacer corte y cerrar caja</button>
    </div> : <div className={styles.panel}>
      <span className={styles.icon}><WalletCards size={30} /></span><h2>Abre la caja para comenzar</h2><p>Escribe cuánto efectivo hay en el cajón antes de la primera venta. Puede ser $0.00.</p>
      <form className={styles.openForm} onSubmit={start}><label>Fondo inicial en efectivo<input type="number" min="0" max="99999999.99" step="0.01" inputMode="decimal" required value={opening} onChange={event => setOpening(event.target.value)} disabled={pending} placeholder="0.00" /></label><button className={styles.primary} disabled={pending || cashAmount(opening) === null}><Banknote size={19} />{pending ? "Guardando…" : "Abrir caja"}</button></form>
      <p className={styles.hint}>Los pedidos pueden guardarse con la caja cerrada, pero no cobrarse. Las ventas anteriores a esta apertura no se agregan al nuevo turno.</p>
    </div>}
    <div className={styles.history}><h2>Cortes anteriores</h2><p>Últimos 30 cortes de la sucursal.</p>{data && !data.history.length && <div className={styles.empty}>Todavía no hay cortes guardados.</div>}
      <div className={styles.historyList}>{data?.history.map(session => <article key={session.id}><div><strong>{when(session.closed_at!)}</strong><small>Cerró {session.closed_by_name ?? "Dueño"}</small></div><div><span>Efectivo contado</span><b>{money.format(session.closing_amount ?? 0)}</b></div><div><span>Diferencia</span><b>{money.format(session.difference ?? 0)}</b></div><button className={styles.secondary} disabled={pending} onClick={() => setDetail(session)}>Ver corte</button></article>)}</div>
    </div>
    {closing && <Dialog title="Contar efectivo y cerrar" onClose={() => { if (!pending) { setClosing(null); setError(""); } }}>
      <p className={styles.hint}>Cuenta sólo el efectivo del cajón, incluido el fondo inicial. Los pedidos sin pagar no entran al corte y se conservan.</p>
      <div className={styles.expected}><span>Efectivo esperado</span><strong>{money.format(closing.expected_amount)}</strong></div>
      <form onSubmit={finish} className={styles.closeForm}><label>Efectivo contado<input type="number" min="0" max="99999999.99" step="0.01" inputMode="decimal" required value={counted} disabled={pending} onChange={event => setCounted(event.target.value)} placeholder="0.00" /></label>
        <p className={styles.difference} role="status">{difference === null ? "Captura lo que contaste para ver la diferencia." : difference === 0 ? "La caja cuadra." : difference < 0 ? `Faltan ${money.format(-difference)}.` : `Sobran ${money.format(difference)}.`}</p>
        <label>Nota del corte (opcional)<textarea maxLength={300} rows={2} value={notes} disabled={pending} onChange={event => setNotes(event.target.value)} placeholder="Ej. se revisó el efectivo con el cajero" /></label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <button className={styles.primary} disabled={pending || closingAmount === null}>{pending ? "Guardando…" : "Confirmar corte y cerrar"}</button>
        <button type="button" className={styles.secondary} disabled={pending} onClick={() => { setClosing(null); setError(""); }}>Volver sin cerrar</button>
      </form>
    </Dialog>}
    {detail && <Dialog title="Corte guardado" onClose={() => setDetail(null)}><div className={styles.detail}>
      <p>Abrió {detail.opened_by_name} · {when(detail.opened_at)}</p><p>Cerró {detail.closed_by_name ?? "Dueño"} · {when(detail.closed_at!)}</p>
      <Breakdown session={detail} /><dl><div><dt>Fondo inicial</dt><dd>{money.format(detail.opening_amount)}</dd></div><div><dt>Efectivo esperado</dt><dd>{money.format(detail.expected_amount)}</dd></div><div><dt>Efectivo contado</dt><dd>{money.format(detail.closing_amount ?? 0)}</dd></div><div><dt>Diferencia</dt><dd>{money.format(detail.difference ?? 0)}</dd></div></dl>
      {detail.notes && <p className={styles.note}>{detail.notes}</p>}<p className={styles.hint}>El corte queda guardado y no se puede editar desde la aplicación.</p><button className={styles.primary} onClick={() => setDetail(null)}>Entendido</button>
    </div></Dialog>}
  </section>;
}

function Metric({ label, amount, primary = false }: { label: string; amount: number; primary?: boolean }) {
  return <div className={primary ? styles.primaryMetric : ""}><span>{label}</span><strong>{money.format(amount)}</strong></div>;
}
function Breakdown({ session }: { session: CashSession }) {
  return <div className={styles.breakdown}><h3>{session.sales_count} {session.sales_count === 1 ? "pedido cobrado" : "pedidos cobrados"}</h3><dl><div><dt>Efectivo</dt><dd>{money.format(session.cash_sales)}</dd></div><div><dt>Tarjeta</dt><dd>{money.format(session.card_sales)}</dd></div><div><dt>Transferencia</dt><dd>{money.format(session.transfer_sales)}</dd></div><div><dt>Total de ventas</dt><dd>{money.format(session.total_sales)}</dd></div></dl></div>;
}
