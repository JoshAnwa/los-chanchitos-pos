"use client";

import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { BrandPlaceholder } from "./brand-placeholder";
import { createClient } from "@/lib/supabase/client";
import styles from "./access-pending.module.css";

export function AccessPending({ unconfigured = false }: { unconfigured?: boolean }) {
  const [error,setError] = useState("");
  async function leave() {
    try {
      const { error: authError } = await createClient().auth.signOut();
      if (authError) throw authError;
      window.location.replace("/login");
    } catch { setError("No se pudo cerrar la sesión. Intenta de nuevo."); }
  }
  return <main className={styles.screen}><section><BrandPlaceholder /><span className={styles.business}>Los Chanchitos · Uso interno</span><LockKeyhole size={30} /><h1>{unconfigured ? "Acceso pendiente de activar" : "Tu acceso está pendiente"}</h1><p>{unconfigured ? "El administrador todavía está preparando el sistema del negocio. El acceso quedará disponible cuando termine la configuración." : "Esta cuenta todavía no está autorizada para entrar. Pide al dueño que active tu acceso."}</p>{!unconfigured && <button onClick={leave}>Salir de esta cuenta</button>}{error && <p role="alert">{error}</p>}</section></main>;
}
