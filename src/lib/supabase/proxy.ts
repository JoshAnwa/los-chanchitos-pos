import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, getSupabaseConfig, isDemoAvailable } from "./config";

export async function updateSession(request: NextRequest) {
  if (!isSupabaseConfigured) {
    if (!isDemoAvailable && request.nextUrl.pathname !== "/login") return NextResponse.redirect(new URL("/login",request.url));
    return NextResponse.next({ request });
  }

  const { url, key } = getSupabaseConfig();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isLogin = request.nextUrl.pathname.startsWith("/login");
  const isPublic = isLogin;
  response.headers.set("Cache-Control", "private, no-store");
  function redirectWithCookies(url: URL) {
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return redirectWithCookies(url);
  }

  if (data?.claims && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/pos";
    return redirectWithCookies(url);
  }

  return response;
}
