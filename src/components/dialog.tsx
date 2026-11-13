"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import styles from "./dialog.module.css";

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={ref} className={styles.dialog} onCancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="dialog-title"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.inner}>
        <header><h2 id="dialog-title">{title}</h2><button onClick={onClose} aria-label="Cerrar ventana"><X size={21} /></button></header>
        {children}
      </div>
    </dialog>
  );
}
