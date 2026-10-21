// =====================================================================
// comum.ts: peças usadas por todas as Edge Functions.
// (configuração, banco, chamadas à API do Instagram, CORS)
// =====================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

// Lê uma variável de ambiente (segredo) sem quebrar se não existir.
export const env = (nome: string, padrao = ""): string => (Deno.env.get(nome) ?? padrao).trim();

export const GRAPH_VERSION = env("GRAPH_API_VERSION", "v21.0");
export const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
export const IG_ACCOUNT_ID = env("IG_ACCOUNT_ID");
// Id usado nas URLs da API ("me" funciona se o IG_ACCOUNT_ID não foi preenchido).
export const IG_ID = IG_ACCOUNT_ID || "me";

// Cliente do banco com a service_role (ignora o RLS). SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY já vêm prontos dentro das Edge Functions.
export const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

// Cabeçalhos pra o painel (navegador) conseguir chamar as funções.
export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Confere se quem chamou é um usuário logado no painel (não só a chave anônima).
export async function exigirUsuario(req: Request): Promise<boolean> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try {
    const { data, error } = await db.auth.getUser(token);
    return !error && !!data?.user;
  } catch {
    return false;
  }
}

// Confere a senha dos robôs agendados (header x-sched-key).
export function checarSched(req: Request): boolean {
  const segredo = env("SCHED_SECRET");
  return segredo.length > 0 && req.headers.get("x-sched-key") === segredo;
}

// Token do Instagram: primeiro o renovado (cofre no banco), senão o do segredo.
let tokenCache: string | null = null;
export async function getToken(): Promise<string> {
  if (tokenCache) return tokenCache;
  try {
    const { data } = await db.from("ig_token_vault").select("access_token").eq("id", "main").maybeSingle();
    if (data?.access_token) return (tokenCache = data.access_token as string);
  } catch { /* segue pro segredo */ }
  return (tokenCache = env("IG_ACCESS_TOKEN"));
}

export type RespostaGraph = { ok: boolean; status: number; data: any; error: any };

// Chamada genérica à API do Instagram. Nunca lança erro: devolve ok=false.
export async function graph(
  caminho: string,
  opcoes: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<RespostaGraph> {
  try {
    const url = new URL(caminho.startsWith("http") ? caminho : `${GRAPH}${caminho}`);
    for (const [k, v] of Object.entries(opcoes.query ?? {})) url.searchParams.set(k, v);
    url.searchParams.set("access_token", await getToken());
    const res = await fetch(url, {
      method: opcoes.method ?? "GET",
      headers: { "Content-Type": "application/json" },
      body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
    });
    let data: any = {};
    try { data = await res.json(); } catch { /* resposta sem corpo */ }
    return { ok: res.ok && !data?.error, status: res.status, data, error: data?.error ?? null };
  } catch (e) {
    return { ok: false, status: 0, data: {}, error: { message: String(e) } };
  }
}
