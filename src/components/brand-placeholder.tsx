import styles from "./brand-placeholder.module.css";

/** Logo proporcionado por el negocio; se conserva el archivo original. */
export function BrandPlaceholder() {
  return <span className={styles.placeholder}><img src="/logo.png" alt="Carnitas Los Chanchitos" width={526} height={519} /></span>;
}
