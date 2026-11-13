import { redirect } from "next/navigation";
import { isSupabaseConfigured, isDemoAvailable } from "@/lib/supabase/config";
import { AccessPending } from "@/components/access-pending";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";
import styles from "./login.module.css";

export default async function LoginPage() {
  if (!isSupabaseConfigured && !isDemoAvailable) return <AccessPending unconfigured />;
  if (isSupabaseConfigured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) redirect("/pos");
  }

  return (
    <main className={styles.shell}>
      <LoginForm configured={isSupabaseConfigured} />
    </main>
  );
}
