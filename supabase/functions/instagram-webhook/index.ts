// =====================================================================
// instagram-webhook: O CÉREBRO.
// Recebe os eventos do Instagram (comentários, mensagens, toques em botão)
// e responde sozinho, sempre passando pelo freio.
//
// Publicar SEMPRE como pública:  supabase functions deploy instagram-webhook --no-verify-jwt
// =====================================================================
import { db, env, graph, IG_ACCOUNT_ID } from "../_shared/comum.ts";
import {
  acharPasso,
  Automacao,
  botoesValidos,
  buscarAutomacao,
  enviarArquivos,
  enviarPrimeiroPassoPorComentario,
  enviarTexto,
  pegarFicha,
  primeiroPasso,
  registrarEntrega,
  salvarLead,
  sendStep,
} from "../_shared/instagram.ts";

const CONTAS_TESTE = env("TEST_IG_ACCOUNTS").split(",").map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------

// Confere a assinatura do Meta (HMAC SHA-256 do corpo com o APP_SECRET).
async function assinaturaValida(corpo: string, cabecalho: string | null): Promise<boolean> {
  const segredo = env("APP_SECRET");
  if (!segredo || !cabecalho) return false;
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const assinatura = await crypto.subtle.sign("HMAC", chave, enc.encode(corpo));
  const esperado = "sha256=" + [...new Uint8Array(assinatura)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (esperado.length !== cabecalho.length) return false;
  let diferenca = 0; // comparação em tempo constante
  for (let i = 0; i < esperado.length; i++) diferenca |= esperado.charCodeAt(i) ^ cabecalho.charCodeAt(i);
  return diferenca === 0;
}

// Marca um evento como processado. Retorna false se já tinha sido (duplicado).
async function primeiraVez(idEvento: string): Promise<boolean> {
  const { error } = await db.from("ig_processed_events").insert({ id: idEvento });
  if (!error) return true;
  if (error.code === "23505") return false; // já existia
  console.warn("Não consegui marcar evento como processado:", error.message);
  return true; // na dúvida, processa
}

// Tira acento e caixa alta pra comparar palavras.
const normalizar = (s: string) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const escaparRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function casaPalavra(auto: Automacao, texto: string): boolean {
  if (auto.match_any) return true;
  const t = normalizar(texto);
  const palavras = (auto.keyword ?? "").split(",").map(normalizar).filter(Boolean);
  // Palavra inteira: "guia" casa com "quero o guia!" mas não com "guiado".
  return palavras.some((p) => new RegExp(`(^|[^a-z0-9])${escaparRegex(p)}([^a-z0-9]|$)`).test(t));
}

async function automacoesAtivas(): Promise<Automacao[]> {
  const { data } = await db.from("ig_automations").select("*").eq("active", true).order("updated_at", { ascending: false });
  const lista = (data ?? []) as Automacao[];
  // Palavras específicas têm prioridade sobre "qualquer palavra".
  return [...lista.filter((a) => !a.match_any), ...lista.filter((a) => a.match_any)];
}

// Regra do "1 por dia": já recebeu (ou está na fila pra receber) nas últimas 24h?
async function jaRecebeuHoje(igUserId: string): Promise<boolean> {
  if (CONTAS_TESTE.includes(igUserId)) return false; // contas de teste ignoram a regra
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db.from("ig_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("ig_user_id", igUserId)
    .eq("canal", "private_reply")
    .in("status", ["ok", "na_fila"])
    .gte("ts", desde);
  return (count ?? 0) > 0;
}

// Resposta pública no comentário, alternando entre as variações (A/B).
async function responderComentario(auto: Automacao, commentId: string) {
  const opcoes = [auto.public_reply ?? "", ...(auto.public_reply_variants ?? [])].map((s) => s.trim()).filter(Boolean);
  if (!opcoes.length) return;
  const texto = opcoes[Math.floor(Math.random() * opcoes.length)];
  const r = await graph(`/${commentId}/replies`, { method: "POST", body: { message: texto } });
  if (!r.ok) console.warn("Resposta pública falhou:", r.error?.message);
}

// ---------------------------------------------------------------------
// Entrega: freio primeiro, depois a Mensagem 1 (ou fila).
// ---------------------------------------------------------------------
async function deliverAutomation(
  auto: Automacao, commentId: string, igUserId: string, username: string,
): Promise<"sent" | "throttled" | "error"> {
  const temFicha = await pegarFicha();
  if (!temFicha) {
    // Sem ficha: guarda na fila. O ig-scheduler manda quando liberar.
    const { error } = await db.from("ig_send_queue").upsert(
      { comment_id: commentId, automation_id: auto.id, ig_user_id: igUserId, username, status: "pendente" },
      { onConflict: "comment_id", ignoreDuplicates: true },
    );
    if (error) {
      console.error("Não consegui pôr na fila:", error.message);
      return "error";
    }
    await registrarEntrega(igUserId, auto.id, "private_reply", "flow", "na_fila", "freio sem ficha");
    return "throttled";
  }
  const r = await enviarPrimeiroPassoPorComentario(auto, commentId, igUserId);
  return r.ok ? "sent" : "error";
}

// ---------------------------------------------------------------------
// COMENTÁRIO
// ---------------------------------------------------------------------
async function handleComment(valor: any, idDaConta: string) {
  const commentId: string = valor?.id;
  const texto: string = valor?.text ?? "";
  const autorId: string = valor?.from?.id;
  const username: string = valor?.from?.username ?? "";
  const mediaId: string = valor?.media?.id ?? "";
  if (!commentId || !autorId) return;

  // 1) Duplicado?
  if (!(await primeiraVez(`comment:${commentId}`))) return;

  // 2) Comentário da própria conta (dono do post)? Ignora.
  if (autorId === IG_ACCOUNT_ID || autorId === idDaConta) return;

  // 3) Acha a automação: palavra + post.
  const auto = (await automacoesAtivas()).find((a) =>
    casaPalavra(a, texto) && (!(a.media_ids?.length) || a.media_ids.includes(mediaId))
  );
  if (!auto) return;

  // 4) Regra do "1 por dia".
  if (await jaRecebeuHoje(autorId)) {
    console.log(`Pulando ${autorId}: já recebeu DM nas últimas 24h.`);
    return;
  }

  // 5) Entrega.
  const resultado = await deliverAutomation(auto, commentId, autorId, username);
  if (resultado === "error") return; // não marca o lead: permite tentar de novo

  await responderComentario(auto, commentId);
  await salvarLead({
    ig_user_id: autorId,
    username,
    last_source: "comment",
    last_keyword: normalizar(texto).slice(0, 100),
    automation_id: auto.id,
  });
}

// ---------------------------------------------------------------------
// MENSAGEM / POSTBACK / QUICK_REPLY
// ---------------------------------------------------------------------
async function buscarLead(igUserId: string) {
  const { data } = await db.from("ig_leads").select("*").eq("ig_user_id", igUserId).maybeSingle();
  return data;
}

// Toque num botão: payload "STEP:idDaAutomacao:proximoPasso".
async function avancarFluxo(igUserId: string, payload: string) {
  const [, autoId, passoId] = payload.split(":");
  if (!autoId || !passoId) return;
  const auto = await buscarAutomacao(autoId);
  if (!auto) return;
  const passo = acharPasso(auto, passoId);
  if (!passo) return;

  // Arquivos da Mensagem 1 que ficaram pendentes (resposta a comentário só leva 1 mensagem).
  const lead = await buscarLead(igUserId);
  const p0 = primeiroPasso(auto);
  if (
    p0?.assets?.length && lead?.last_source === "comment" && lead?.flow_step === String(p0.id) &&
    botoesValidos(p0).some((b) => String(b.next) === String(passoId))
  ) {
    await enviarArquivos(p0.assets, igUserId);
  }

  const r = await sendStep(auto, passo, { id: igUserId }, igUserId);
  await registrarEntrega(igUserId, auto.id, "dm", "flow", r.ok ? "ok" : "erro", r.motivo);
}

// A pessoa respondeu com um dado que um passo pediu (email/telefone).
async function coletarDado(igUserId: string, lead: any, texto: string) {
  const exp = lead.expecting;
  const bruto = texto.trim();
  let valor = bruto;
  let valido = bruto.length > 0;
  let pedidoDeNovo = "Não entendi. Pode mandar de novo?";

  if (exp.field === "email") {
    valor = bruto.toLowerCase();
    valido = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor);
    pedidoDeNovo = "Hmm, esse e-mail parece estranho. Pode mandar de novo? (ex: nome@email.com)";
  } else if (exp.field === "telefone") {
    valor = bruto.replace(/\D/g, "");
    valido = valor.length >= 10 && valor.length <= 15;
    pedidoDeNovo = "Hmm, esse número parece incompleto. Pode mandar de novo com DDD?";
  }

  if (!valido) {
    await enviarTexto({ id: igUserId }, pedidoDeNovo);
    return;
  }

  const campos: Record<string, unknown> = { ig_user_id: igUserId, expecting: null };
  if (exp.field === "email" || exp.field === "telefone") campos[exp.field] = valor;
  else campos.dados = { ...(lead.dados ?? {}), [exp.field]: valor };
  await salvarLead(campos);

  // Segue o fluxo, se o passo apontou um próximo.
  if (exp.next !== null && exp.next !== undefined && exp.next !== "") {
    const auto = await buscarAutomacao(exp.automation_id);
    const passo = auto && acharPasso(auto, exp.next);
    if (auto && passo) {
      const r = await sendStep(auto, passo, { id: igUserId }, igUserId);
      await registrarEntrega(igUserId, auto.id, "dm", "flow", r.ok ? "ok" : "erro", r.motivo);
      return;
    }
  }
  await enviarTexto({ id: igUserId }, "Anotado, obrigado! 🙌");
}

async function handleMessage(ev: any) {
  const remetente: string = ev?.sender?.id;
  if (!remetente) return;

  // Echo = mensagem que a própria conta enviou (pelo sistema ou manualmente). Ignora.
  if (ev.message?.is_echo || remetente === IG_ACCOUNT_ID) return;

  // Só interessa mensagem de texto, postback ou quick_reply (ignora leitura, reação etc.).
  if (!ev.message && !ev.postback) return;

  const mid: string | undefined = ev.message?.mid ?? ev.postback?.mid;
  if (mid) {
    const { data: nossa } = await db.from("ig_bot_sends").select("mid").eq("mid", mid).maybeSingle();
    if (nossa) return; // é um envio do próprio sistema
    if (!(await primeiraVez(`msg:${mid}`))) return; // duplicado
  }

  // Toque em botão: chega como postback OU como quick_reply. Trata os dois.
  const payload: string | undefined = ev.postback?.payload ?? ev.message?.quick_reply?.payload;
  if (payload?.startsWith("STEP:")) {
    await avancarFluxo(remetente, payload);
    return;
  }

  const texto: string = ev.message?.text ?? "";
  if (!texto) return;

  // Um passo pediu um dado? Essa mensagem é a resposta.
  const lead = await buscarLead(remetente);
  if (lead?.expecting?.field) {
    await coletarDado(remetente, lead, texto);
    return;
  }

  // DM (ou resposta a story) com palavra-chave: dispara a automação pela DM.
  const auto = (await automacoesAtivas()).find((a) => !a.match_any && casaPalavra(a, texto));
  if (!auto) return; // mensagem solta: silêncio
  const p0 = primeiroPasso(auto);
  if (!p0) return;
  const r = await sendStep(auto, p0, { id: remetente }, remetente);
  await registrarEntrega(remetente, auto.id, "dm", "flow", r.ok ? "ok" : "erro", r.motivo);
  if (r.ok) {
    await salvarLead({
      ig_user_id: remetente,
      last_source: ev.message?.reply_to?.story ? "story_reply" : "dm",
      last_keyword: normalizar(texto).slice(0, 100),
      automation_id: auto.id,
    });
  }
}

// ---------------------------------------------------------------------
// Entrada HTTP
// ---------------------------------------------------------------------
Deno.serve(async (req) => {
  const url = new URL(req.url);

  // a) Verificação (aperto de mão com o Meta).
  if (req.method === "GET") {
    const modo = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const desafio = url.searchParams.get("hub.challenge") ?? "";
    if (modo === "subscribe" && token && token === env("VERIFY_TOKEN")) {
      return new Response(desafio, { status: 200 });
    }
    return new Response("Token de verificação inválido", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Método não permitido", { status: 405 });

  // b) Recebimento.
  const corpo = await req.text();
  const assinaturaOk = await assinaturaValida(corpo, req.headers.get("x-hub-signature-256"));
  if (!assinaturaOk) {
    if (env("APP_SECRET_ENFORCE").toLowerCase() === "true") {
      return new Response("Assinatura inválida", { status: 401 });
    }
    console.warn("AVISO: assinatura inválida ou ausente. Processando mesmo assim (APP_SECRET_ENFORCE desligado).");
  }

  let evento: any;
  try {
    evento = JSON.parse(corpo);
  } catch {
    return new Response("ok", { status: 200 });
  }

  try {
    for (const entrada of evento?.entry ?? []) {
      for (const mudanca of entrada.changes ?? []) {
        if (mudanca.field === "comments") await handleComment(mudanca.value, String(entrada.id ?? ""));
      }
      for (const ev of entrada.messaging ?? []) await handleMessage(ev);
    }
  } catch (e) {
    console.error("Erro processando evento:", e);
  }

  // Sempre 200, senão o Meta reenvia sem parar.
  return new Response("EVENT_RECEIVED", { status: 200 });
});
