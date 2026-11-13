"use client";

import { useState } from "react";
import { ArrowLeftRight, Banknote, Check, CreditCard, WalletCards } from "lucide-react";
import { Dialog } from "@/components/dialog";
import { money, paymentLabels, roundMoney, type Payment, type PaymentMethod } from "@/lib/pos";
import styles from "./pos.module.css";

const methods = [
  { id: "cash", label: "Efectivo", icon: Banknote },
  { id: "card", label: "Tarjeta", icon: CreditCard },
  { id: "transfer", label: "Transferencia", icon: ArrowLeftRight },
  { id: "combined", label: "Combinado", icon: WalletCards },
] as const;

export function PaymentDialog({ total, label, demo, onClose, onConfirm }: {
  total: number; label: string; demo: boolean; onClose: () => void;
  onConfirm: (payments: Payment[]) => Promise<string | undefined>;
}) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [received, setReceived] = useState(String(total));
  const [cashPart, setCashPart] = useState("");
  const [secondMethod, setSecondMethod] = useState<"card" | "transfer">("card");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const cash = Number(cashPart);
  const receivedAmount = Number(received);
  const valid = method === "cash" ? Number.isFinite(receivedAmount) && receivedAmount >= total
    : method === "combined" ? Number.isFinite(cash) && cash > 0 && cash < total : true;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setError("");
    const payments: Payment[] = method === "combined"
      ? [{ method: "cash", amount: roundMoney(cash) }, { method: secondMethod, amount: roundMoney(total - cash) }]
      : [{ method, amount: total }];
    try {
      const message = await onConfirm(payments);
      if (message) setError(message);
    } catch {
      setError("No pudimos completar el cobro. Intenta de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog title="Cobrar pedido" onClose={() => { if (!pending) onClose(); }}>
      <div className={styles.paymentTotal}><span>{label} · Total a cobrar</span><strong>{money.format(total)}</strong></div>
      <form onSubmit={submit}>
        <p className={styles.fieldTitle}>¿Cómo te pagan?</p>
        <div className={styles.paymentGrid}>
          {methods.map(({ id, label: name, icon: Icon }) => <button key={id} type="button" disabled={pending} aria-pressed={method === id}
            className={method === id ? styles.paymentActive : ""} onClick={() => setMethod(id)}><Icon size={22} />{name}</button>)}
        </div>
        {method === "cash" && <>
          <label className={styles.field}>Recibiste<input disabled={pending} type="number" min={total} step="0.01" inputMode="decimal" value={received} onChange={(event) => setReceived(event.target.value)} required /></label>
          <div className={styles.changeRow}><span>Cambio para el cliente</span><b>{money.format(Math.max(0, receivedAmount - total))}</b></div>
        </>}
        {method === "combined" && <>
          <label className={styles.field}>Parte en efectivo<input disabled={pending} type="number" min="0.01" max={roundMoney(total - .01)} step="0.01" inputMode="decimal" value={cashPart} onChange={(event) => setCashPart(event.target.value)} required placeholder="0.00" /></label>
          <label className={styles.field}>El resto se paga con<select disabled={pending} value={secondMethod} onChange={(event) => setSecondMethod(event.target.value as "card" | "transfer")}><option value="card">Tarjeta</option><option value="transfer">Transferencia</option></select></label>
          <div className={styles.changeRow}><span>{paymentLabels[secondMethod]}</span><b>{money.format(Math.max(0, total - cash))}</b></div>
        </>}
        {(method === "card" || method === "transfer") && <p className={styles.inlineNote}>Confirma que recibiste el pago antes de marcar el pedido como pagado.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.primaryButton} disabled={!valid || pending}><Check size={19} />{pending ? "Guardando…" : demo ? "Confirmar pago de prueba" : "Confirmar pago"}</button>
        {demo && <p className={styles.footnote}>Demostración: no se cobra dinero ni se registra una venta real.</p>}
      </form>
    </Dialog>
  );
}
