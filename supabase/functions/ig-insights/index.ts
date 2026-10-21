// =====================================================================
// ig-insights: métricas pro dashboard (seguidores, novos por dia, alcance).
// Só responde pra usuário logado no painel.
//
// Publicar:  supabase functions deploy ig-insights
// =====================================================================
import { cors, exigirUsuario, getToken, graph, IG_ID, json } from "../_shared/comum.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await exigirUsuario(req))) return json({ erro: "Faça login no painel." }, 401);
  if (!(await getToken())) return json({ conectado: false, erro: "Token do Instagram não configurado." });

  const perfil = await graph(`/${IG_ID}`, { query: { fields: "username,followers_count,media_count" } });
  if (!perfil.ok) return json({ conectado: false, erro: perfil.error?.message ?? "Falha ao ler o perfil." });

  // Série diária dos últimos 15 dias. Se a métrica não vier, devolve lista vazia.
  const ate = Math.floor(Date.now() / 1000);
  const desde = ate - 15 * 86400;
  async function serie(metric: string) {
    const r = await graph(`/${IG_ID}/insights`, {
      query: { metric, period: "day", since: String(desde), until: String(ate) },
    });
    if (!r.ok) return [];
    return (r.data?.data?.[0]?.values ?? []).map((v: any) => ({
      data: String(v.end_time ?? "").slice(0, 10),
      valor: Number(v.value ?? 0),
    }));
  }

  const [novos, alcance] = await Promise.all([serie("follower_count"), serie("reach")]);
  return json({
    conectado: true,
    username: perfil.data.username,
    seguidores: perfil.data.followers_count ?? 0,
    posts: perfil.data.media_count ?? 0,
    novos_seguidores: novos,
    alcance,
  });
});
