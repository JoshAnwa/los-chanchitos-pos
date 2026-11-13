"use client";
import {useEffect,useRef,useState} from "react";
import {getSales} from "@/lib/owner-api";
import {localDay,type SalesReport} from "@/lib/owner-data";
import {money,paymentLabels,type PaymentMethod} from "@/lib/pos";
import s from "./owner.module.css";
export function SalesPanel({demo}:{demo:boolean}) {
  const [from,setFrom]=useState(()=>localDay());const [to,setTo]=useState(()=>localDay());const [range,setRange]=useState<{from:string;to:string}|null>(null);
  const [data,setData]=useState<SalesReport|null>(null);const [error,setError]=useState("");const [busy,setBusy]=useState(false);const lock=useRef(false);
  useEffect(()=>{if(demo)return;let alive=true;const day=localDay();getSales(day,day).then(r=>{if(alive){setData(r);setRange({from:day,to:day});}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[demo]);
  async function load(){if(lock.current||demo)return;lock.current=true;setBusy(true);setError("");try{setData(await getSales(from,to));setRange({from,to});}catch(e){setError(e instanceof Error?e.message:"No se pudo consultar el reporte.");}finally{lock.current=false;setBusy(false);}}
  return <section className={s.root}><div className={s.toolbar}><div><h2>¿Cuánto vendiste?</h2><p>Consulta lo cobrado, sin sumar pedidos pendientes ni cancelados.</p></div></div><form className={`${s.form} ${s.range}`} onSubmit={e=>{e.preventDefault();load();}}><label>Desde<input type="date" value={from} required onChange={e=>setFrom(e.target.value)}/></label><label>Hasta<input type="date" value={to} min={from} required onChange={e=>setTo(e.target.value)}/></label><button className={s.primary} disabled={demo||busy||!from||!to||to<from}>{busy?"Consultando…":"Ver ventas"}</button></form>{error&&<p className={s.error} role="alert">{error}</p>}{demo&&<p className={s.empty}>Demostración: no mostramos ventas inventadas. Los reportes aparecerán al entrar con la cuenta Dueño.</p>}
    {data&&<><p className={s.hint}>Periodo consultado: {range?.from} al {range?.to}, ambos incluidos. Horario de Ciudad de México. {range&&(range.from!==from||range.to!==to)&&"Cambiaste las fechas: pulsa Ver ventas para actualizar."}</p><div className={s.metrics}><div><span>Ventas cobradas</span><strong>{money.format(data.total)}</strong></div><div><span>Pedidos cobrados</span><strong>{data.count}</strong></div><div><span>Pedidos cancelados</span><strong>{data.cancelled}</strong></div><div><span>Compras registradas</span><strong>{money.format(data.purchases)}</strong></div></div>
      <div className={s.cards}>{["cash","card","transfer"].map(method=><article className={s.card} key={method}><h3>{paymentLabels[method as PaymentMethod]}</h3><strong className={s.stock}>{money.format(data.methods.find(m=>m.method===method)?.amount??0)}</strong></article>)}</div><p className={s.hint}>Esto no es una ganancia calculada: faltan gastos, costos completos y otros conceptos. Las compras no se descuentan automáticamente de la caja.</p>
      <div className={s.section}><h3>Productos vendidos</h3>{data.products.length?<div className={s.table}><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Importe</th></tr></thead><tbody>{data.products.map(p=><tr key={p.name}><td>{p.name}</td><td>{p.quantity}</td><td>{money.format(p.amount)}</td></tr>)}</tbody></table></div>:<p className={s.empty}>No hay ventas cobradas en este periodo.</p>}</div>
    </>}
  </section>;
}
