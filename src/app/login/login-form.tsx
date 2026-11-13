"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import styles from "./login.module.css";
import { BrandPlaceholder } from "@/components/brand-placeholder";

export function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!configured) {
      router.push("/pos");
      return;
    }

    const form = new FormData(event.currentTarget);
    setPending(true);
    try {
      const { error: signInError } = await createClient().auth.signInWithPassword({
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      if (signInError) {
        setError("No pudimos entrar. Revisa tu correo y contraseña.");
        return;
      }
      router.push("/pos");
      router.refresh();
    } catch {
      setError("No pudimos conectar. Revisa tu internet e intenta de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.formCard}>
      <header className={styles.brand}>
        <BrandPlaceholder />
        <div><h1>Los Chanchitos</h1><p>Punto de venta</p></div>
      </header>

      {!configured && (
        <div className={styles.demoNotice}>
          Estás viendo el diseño inicial. Puedes recorrer la demostración sin una cuenta.
        </div>
      )}

      <form onSubmit={signIn} className={styles.form} noValidate={!configured}>
        <label>
          Correo electrónico
          <span className={styles.inputWrap}>
            <input name="email" type="email" autoComplete="username" required={configured} />
          </span>
        </label>
        <label>
          Contraseña
          <span className={styles.inputWrap}>
            <input name="password" autoComplete="current-password" type={showPassword ? "text" : "password"} required={configured} />
            <button type="button" className={styles.eye} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}>
              {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </span>
        </label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.submit} disabled={pending}>
          {pending ? "Entrando…" : configured ? "Iniciar sesión" : "Ver demostración"}
        </button>
      </form>
      <p className={styles.security}>Acceso para el personal del local.</p>
    </div>
  );
}
