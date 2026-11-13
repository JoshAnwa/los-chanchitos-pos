const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const isSupabaseConfigured = Boolean(url && key && !url.includes("TU-PROYECTO") && !key.includes("REEMPLAZAR"));
// La demostración existe sólo con `next dev`. Producción siempre requiere cuenta.
export const isDemoAvailable = process.env.NODE_ENV === "development" && !isSupabaseConfigured;

export function getSupabaseConfig() {
  if (!isSupabaseConfigured || !url || !key) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }

  return { url, key };
}
