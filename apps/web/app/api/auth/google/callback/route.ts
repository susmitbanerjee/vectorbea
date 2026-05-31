import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth/cookies";
import { signToken } from "@/lib/auth/jwt";
import { getUserWorkspaces } from "@/lib/auth/neon-auth";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function upsertUser(oauthId: string, email: string, name?: string, picture?: string) {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`INSERT INTO app_users (supabase_user_id,email,full_name,avatar_url,status,email_verified)
    VALUES (${oauthId},${email},${name ?? null},${picture ?? null},'active',TRUE)
    ON CONFLICT (supabase_user_id) DO UPDATE
      SET email=COALESCE(EXCLUDED.email,app_users.email),
          full_name=COALESCE(EXCLUDED.full_name,app_users.full_name),
          avatar_url=COALESCE(EXCLUDED.avatar_url,app_users.avatar_url),
          updated_at=now()`;
  const rows = await sql`SELECT id FROM app_users WHERE supabase_user_id=${oauthId} LIMIT 1` as {id:string}[];
  const uid = rows[0]?.id;
  if (!uid) throw new Error("upsert failed");
  if ((await getUserWorkspaces(uid)).length === 0) {
    const slug = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 40);
    const wsName = (name ?? email.split("@")[0]) + String.fromCharCode(39) + "s Workspace";
    const wr = await sql`INSERT INTO workspaces(name,slug,owner_user_id) VALUES(${wsName},${slug},${uid}) ON CONFLICT(slug) DO UPDATE SET slug=${slug}||'-'||substr(md5(random()::text),1,6) RETURNING id` as {id:string}[];
    const wid = wr[0]?.id;
    if (wid) {
      await sql`INSERT INTO environments(workspace_id,name,slug,type) VALUES(${wid},'Development','development','development') ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO workspace_members(workspace_id,user_id,role,status) VALUES(${wid},${uid},'owner','active') ON CONFLICT DO NOTHING`;
    }
  }
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookieStore = await cookies();
  if (searchParams.get("error") || !code) return NextResponse.redirect(new URL("/signin?error=oauth", request.url));
  if (cookieStore.get("oauth_state")?.value !== state) return NextResponse.redirect(new URL("/signin?error=oauth", request.url));
  const verifier = cookieStore.get("oauth_code_verifier")?.value;
  if (!verifier) return NextResponse.redirect(new URL("/signin?error=oauth", request.url));

  const tr = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: origin + "/api/auth/google/callback", code_verifier: verifier, grant_type: "authorization_code" }),
  });
  if (!tr.ok) { console.error("[google/callback]", await tr.text()); return NextResponse.redirect(new URL("/signin?error=callback_failed", request.url)); }
  const tk = await tr.json() as { id_token?: string; access_token?: string };

  let email = "", name = "", picture = "", sub = "";
  if (tk.id_token) {
    try {
      const p = JSON.parse(Buffer.from(tk.id_token.split(".")[1]!, "base64url").toString()) as Record<string,string>;
      sub = p.sub ?? ""; email = p.email ?? ""; name = p.name ?? ""; picture = p.picture ?? "";
    } catch { /* ignore */ }
  }
  if (!email && tk.access_token) {
    const ui = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + tk.access_token } });
    if (ui.ok) { const d = await ui.json() as Record<string,string>; sub=d.sub??""; email=d.email??""; name=d.name??""; picture=d.picture??""; }
  }
  if (!email || !sub) return NextResponse.redirect(new URL("/signin?error=callback_failed", request.url));

  const oauthId = "google:" + sub;
  try {
    await upsertUser(oauthId, email, name, picture);
    const token = await signToken({ sub: oauthId, email });
    const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 7 };
    const res = NextResponse.redirect(new URL("/dashboard", request.url));
    res.cookies.set(AUTH_COOKIE_NAME, token, opts);
    res.cookies.set("vb-token-transfer", token, { ...opts, httpOnly: false, maxAge: 60 });
    ["oauth_code_verifier","oauth_state","oauth_next"].forEach(n => res.cookies.set(n, "", { ...opts, maxAge: 0 }));
    return res;
  } catch (err) { console.error("[google/callback]", err); return NextResponse.redirect(new URL("/signin?error=callback_failed", request.url)); }
}
