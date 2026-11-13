import { ArrowRight, ChevronRight, ClipboardList, Utensils, WalletCards } from "lucide-react";
import s from "./owner.module.css";

const management = [
  { id: "menu", title: "Productos", description: "Menú y precios" },
  { id: "inventario", title: "Inventario", description: "Ingredientes, compras y recetas" },
  { id: "reportes", title: "Ventas", description: "Historial y totales" },
  { id: "negocio", title: "Mi negocio", description: "Datos del local y del ticket" },
] as const;

type HomeView = "venta" | "pedidos" | "caja" | (typeof management)[number]["id"];

export function HomePanel({ isOwner, cashOpen, pendingCount, onNavigate }: {
  isOwner: boolean;
  cashOpen: boolean | null;
  pendingCount: number;
  onNavigate: (view: HomeView) => void;
}) {
  return (
    <section className={s.home} aria-label="Inicio del punto de venta">
      <div className={s.counter}>
        <div className={s.counterStatus}>
          <h2>Mostrador</h2>
          <span className={cashOpen ? s.openStatus : s.cashStatus}>
            {cashOpen === null ? "Caja sin confirmar" : cashOpen ? "Caja abierta" : "Caja cerrada"}
          </span>
        </div>
        <div className={s.counterActions}>
          <button className={s.sell} onClick={() => onNavigate("venta")}><Utensils size={22} /> Tomar pedido <ArrowRight size={20} /></button>
          <button onClick={() => onNavigate("pedidos")}><ClipboardList size={20} /> Pedidos <b>{pendingCount}</b></button>
          {isOwner && <button onClick={() => onNavigate("caja")}><WalletCards size={20} /> {cashOpen === false ? "Abrir caja" : "Ver caja"}</button>}
        </div>
      </div>

      {isOwner && (
        <>
          <section className={s.management} aria-labelledby="management-title">
            <h2 id="management-title">Administración</h2>
            <ul>
              {management.map(({ id, title, description }) => (
                <li key={id}>
                  <button onClick={() => onNavigate(id)}><strong>{title}</strong><span>{description}</span><ChevronRight size={20} /></button>
                </li>
              ))}
            </ul>
          </section>
          <section className={s.upcoming} aria-labelledby="upcoming-title">
            <h2 id="upcoming-title">Próximamente</h2>
            <ul><li>Envío automático de comandas a cocina</li><li>Administración de usuarios desde la app</li><li>App instalable</li></ul>
          </section>
        </>
      )}
    </section>
  );
}
