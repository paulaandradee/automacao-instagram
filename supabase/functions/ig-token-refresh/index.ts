// =====================================================================
// ig-token-refresh: renova o token long-lived (~60 dias). Roda 1x por semana.
// Protegido pelo header x-sched-key = SCHED_SECRET.
//
// Publicar:  supabase functions deploy ig-token-refresh --no-verify-jwt
// =====================================================================
import { checarSched, db, getToken, json } from "../_shared/comum.ts";

Deno.serve(async (req) => {
  if (!checarSched(req)) return json({ erro: "não autorizado" }, 401);

  const agora = new Date().toISOString();
  const token = await getToken();
  if (!token) return json({ ok: false, erro: "IG_ACCESS_TOKEN não configurado" }, 400);

  // Atenção: este endpoint NÃO leva a versão (v21.0) no caminho.
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  let data: any = {};
  let ok = false;
  try {
    const res = await fetch(url);
    data = await res.json();
    ok = res.ok && !!data.access_token;
  } catch (e) {
    data = { error: { message: String(e) } };
  }

  if (!ok) {
    const motivo = data?.error?.message ?? "falha desconhecida";
    await db.from("ig_token_status").upsert({ id: "main", last_ok: false, last_error: motivo, updated_at: agora });
    return json({ ok: false, erro: motivo }, 500);
  }

  const expira = new Date(Date.now() + Number(data.expires_in ?? 5184000) * 1000).toISOString();
  // Guarda o token novo no cofre (as outras funções passam a usar ele).
  await db.from("ig_token_vault").upsert({ id: "main", access_token: data.access_token, updated_at: agora });
  await db.from("ig_token_status").upsert({
    id: "main", expires_at: expira, last_ok: true, last_error: null, last_refreshed_at: agora, updated_at: agora,
  });
  return json({ ok: true, expires_at: expira });
});
