import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Netlify's Windows build cannot package the Node.js proxy as an Edge Function.
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
