// =====================================================================
// ig-media: lista os posts da conta (com miniatura) pro seletor
// "Em quais posts" do editor. Só responde pra usuário logado.
//
// Publicar:  supabase functions deploy ig-media
// =====================================================================
import { cors, exigirUsuario, getToken, graph, IG_ID, json } from "../_shared/comum.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await exigirUsuario(req))) return json({ erro: "Faça login no painel." }, 401);
  if (!(await getToken())) return json({ conectado: false, posts: [] });

  const r = await graph(`/${IG_ID}/media`, {
    query: { fields: "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp", limit: "50" },
  });
  if (!r.ok) return json({ conectado: false, posts: [], erro: r.error?.message });

  const posts = (r.data?.data ?? []).map((m: any) => ({
    id: m.id,
    legenda: (m.caption ?? "").slice(0, 120),
    tipo: m.media_type,
    miniatura: m.thumbnail_url ?? m.media_url ?? "",
    link: m.permalink,
    data: m.timestamp,
  }));
  return json({ conectado: true, posts });
});
