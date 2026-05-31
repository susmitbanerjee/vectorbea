import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { signToken } from "@/lib/auth/jwt";
import { upsertOAuthUser } from "@/lib/auth/oauth-upsert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookieStore = await cookies();
  if (searchParams.get("error") || !code) return NextResponse.redirect(new URL("/signin?error=oauth", request.url));
  if (cookieStore.get("oauth_state")?.value !== state) return NextResponse.redirect(new URL("/signin?error=oauth", request.url));
  const verifier = cookieStore.get("oauth_code_verifier")?.value;
  if (!verifier) return NextResponse.redirect(new URL("/signin?error=oauth", request.url));

  const tenant = process.env.AZURE_TENANT_ID ?? "common";
  const tr = await fetch("https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.AZURE_CLIENT_ID!, client_secret: process.env.AZURE_CLIENT_SECRET ?? "",
      redirect_uri: origin + "/api/auth/microsoft/callback", code_verifier: verifier, grant_type: "authorization_code" }),
  });
  if (!tr.ok) { console.error("[microsoft/callback]", await tr.text()); return NextResponse.redirect(new URL("/signin?error=callback_failed", request.url)); }
  const tk = await tr.json() as { id_token?: string; access_token?: string };

  let email = "", name = "", sub = "";
  if (tk.id_token) {
    try {
      const p = JSON.parse(Buffer.from(tk.id_token.split(".")[1]!, "base64url").toString()) as Record<string,string>;
      sub=p.sub??p.oid??""; email=p.email??p.preferred_username??""; name=p.name??"";
    } catch { /* ignore */ }
  }
  if (!email && tk.access_token) {
    const ui = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,mail,displayName", { headers: { Authorization: "Bearer " + tk.access_token } });
    if (ui.ok) { const d = await ui.json() as Record<string,string>; sub=d.id??""; email=d.mail??""; name=d.displayName??""; }
  }
  if (!email || !sub) return NextResponse.redirect(new URL("/signin?error=callback_failed", request.url));

  try {
    const jwtSub = await upsertOAuthUser("microsoft:" + sub, email, name);
    const token = await signToken({ sub: jwtSub, email });
    const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 7 };
    const res = NextResponse.redirect(new URL("/dashboard", request.url));
    res.cookies.set(AUTH_COOKIE_NAME, token, opts);
    res.cookies.set("vb-token-transfer", token, { ...opts, httpOnly: false, maxAge: 60 });
    ["oauth_code_verifier","oauth_nonce","oauth_state","oauth_next"].forEach(n => res.cookies.set(n, "", { ...opts, maxAge: 0 }));
    return res;
  } catch (err) { console.error("[microsoft/callback]", err); return NextResponse.redirect(new URL("/signin?error=callback_failed", request.url)); }
}
