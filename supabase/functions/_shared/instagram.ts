// =====================================================================
// instagram.ts: envio de mensagens, fluxo de botões, freio e leads.
// Usado pelo instagram-webhook e pelo ig-scheduler.
// =====================================================================
import { db, graph, IG_ID } from "./comum.ts";

export type Botao = { title: string; next?: number | string | null; url?: string | null };
export type Passo = {
  id: number | string;
  message?: string;
  buttons?: Botao[];
  assets?: string[];
  collect?: { field: string; next?: number | string | null };
  delay?: { seconds: number; next: number | string };
};
export type Automacao = {
  id: string;
  nome: string;
  keyword: string;
  match_any: boolean;
  active: boolean;
  media_ids: string[] | null;
  public_reply: string | null;
  public_reply_variants: string[] | null;
  flow: { steps: Passo[] } | null;
};

// Pra quem vai a mensagem: resposta privada a um comentário, ou DM pelo id.
export type Destino = { comment_id: string } | { id: string };

export type ResultadoEnvio = { ok: boolean; hard: boolean; formato: string; motivo: string | null };

const CHAVE_FREIO = "private_reply";

// ---------------------------------------------------------------------
// Fluxo
// ---------------------------------------------------------------------
const temNext = (b: Botao) => b.next !== undefined && b.next !== null && String(b.next) !== "";

// Só valem botões com nome E destino (link ou próximo passo). O resto é descartado.
export function botoesValidos(passo: Passo): Botao[] {
  return (passo.buttons ?? [])
    .filter((b) => b && (b.title ?? "").trim() && (b.url || temNext(b)))
    .map((b) => ({ ...b, title: b.title.trim().slice(0, 20) })); // Instagram corta em 20
}

// A Mensagem 1 é SEMPRE o primeiro item do array (não importa o id).
export const primeiroPasso = (a: Automacao): Passo | null => a.flow?.steps?.[0] ?? null;

export const acharPasso = (a: Automacao, id: string | number): Passo | null =>
  a.flow?.steps?.find((s) => String(s.id) === String(id)) ?? null;

export async function buscarAutomacao(id: string): Promise<Automacao | null> {
  const { data } = await db.from("ig_automations").select("*").eq("id", id).maybeSingle();
  return (data as Automacao) ?? null;
}

// Erros "duros" = bloqueio ou limite do Instagram. Alimentam o disjuntor.
function ehErroDuro(status: number, erro: any): boolean {
  return status === 429 || [4, 17, 32, 368, 613].includes(Number(erro?.code));
}

// ---------------------------------------------------------------------
// Envio cru
// ---------------------------------------------------------------------
async function enviarMensagem(dest: Destino, message: unknown) {
  const r = await graph(`/${IG_ID}/messages`, { method: "POST", body: { recipient: dest, message } });
  // Guarda o id da mensagem enviada pra reconhecer o "echo" depois.
  const mid = r.data?.message_id;
  if (r.ok && mid) await db.from("ig_bot_sends").upsert({ mid }, { ignoreDuplicates: true });
  return r;
}

export async function enviarTexto(dest: Destino, texto: string) {
  return enviarMensagem(dest, { text: texto.slice(0, 1000) });
}

// Manda os arquivos (foto, áudio, vídeo, PDF). Se o Instagram recusar, manda o link.
export async function enviarArquivos(ids: string[], igUserId: string) {
  if (!ids?.length) return;
  const { data } = await db.from("ig_assets").select("*").in("id", ids);
  for (const arq of data ?? []) {
    const payload = arq.attachment_id ? { attachment_id: arq.attachment_id } : { url: arq.public_url };
    const r = await enviarMensagem({ id: igUserId }, { attachment: { type: arq.tipo, payload } });
    if (!r.ok) await enviarTexto({ id: igUserId }, `${arq.nome}: ${arq.public_url}`);
  }
}

// ---------------------------------------------------------------------
// sendStep: envia UM passo do fluxo com os botões ANEXADOS ao balão.
// Ordem de tentativa: button template -> quick_reply (pílula) -> texto puro.
// ---------------------------------------------------------------------
export async function sendStep(
  auto: Automacao,
  passo: Passo,
  dest: Destino,
  igUserId: string,
): Promise<ResultadoEnvio> {
  const texto = (passo.message ?? "").trim() || "👇";
  const botoes = botoesValidos(passo);
  const payloadDe = (b: Botao) => `STEP:${auto.id}:${b.next}`;
  const linksNoTexto = botoes.filter((b) => b.url).map((b) => `${b.title}: ${b.url}`).join("\n");
  const avancam = botoes.filter((b) => !b.url && temNext(b));

  const tentativas: [string, unknown][] = [];

  // 1) Botões anexados (máximo 3 no button template).
  if (botoes.length > 0 && botoes.length <= 3) {
    tentativas.push(["botao", {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: texto.slice(0, 640),
          buttons: botoes.map((b) =>
            b.url
              ? { type: "web_url", url: b.url, title: b.title }
              : { type: "postback", title: b.title, payload: payloadDe(b) }
          ),
        },
      },
    }]);
  }
  // 2) Pílulas (quick_reply): cabem até 13; links vão no texto.
  if (avancam.length > 0) {
    tentativas.push(["pilula", {
      text: (linksNoTexto ? `${texto}\n\n${linksNoTexto}` : texto).slice(0, 1000),
      quick_replies: avancam.slice(0, 13).map((b) => ({
        content_type: "text",
        title: b.title,
        payload: payloadDe(b),
      })),
    }]);
  }
  // 3) Texto puro (com o link no texto, se houver): a mensagem nunca deixa de chegar.
  tentativas.push(["texto", { text: (linksNoTexto ? `${texto}\n\n${linksNoTexto}` : texto).slice(0, 1000) }]);

  let resultado: ResultadoEnvio = { ok: false, hard: false, formato: "", motivo: "sem tentativa" };
  for (const [formato, message] of tentativas) {
    const r = await enviarMensagem(dest, message);
    if (r.ok) {
      resultado = { ok: true, hard: false, formato, motivo: null };
      break;
    }
    const hard = ehErroDuro(r.status, r.error);
    resultado = { ok: false, hard, formato, motivo: r.error?.message ?? `HTTP ${r.status}` };
    console.warn(`Envio em formato "${formato}" recusado:`, resultado.motivo);
    if (hard) break; // bloqueio/limite: não insiste em outro formato
  }

  if (!resultado.ok) return resultado;

  // Arquivos do passo: só dá pra mandar por DM (resposta a comentário é 1 mensagem só).
  // Os da Mensagem 1 enviada por comentário saem quando a pessoa toca no botão.
  if ("id" in dest && passo.assets?.length) await enviarArquivos(passo.assets, igUserId);

  // Atualiza onde a pessoa está na conversa.
  const lead: Record<string, unknown> = {
    ig_user_id: igUserId,
    automation_id: auto.id,
    flow_step: String(passo.id),
    expecting: null,
  };
  if (botoes.some((b) => b.url)) lead.link_sent = true;
  if (passo.collect?.field) {
    lead.expecting = {
      automation_id: auto.id,
      step_id: String(passo.id),
      field: passo.collect.field,
      next: passo.collect.next ?? null,
    };
  }
  await db.from("ig_leads").upsert(lead, { onConflict: "ig_user_id" });

  // Passo com atraso: agenda o próximo pra sair sozinho.
  if (passo.delay && passo.delay.next !== undefined && passo.delay.next !== null) {
    const segundos = Math.max(5, Number(passo.delay.seconds) || 30);
    await db.from("ig_scheduled").insert({
      ig_user_id: igUserId,
      automation_id: auto.id,
      step_id: String(passo.delay.next),
      send_at: new Date(Date.now() + segundos * 1000).toISOString(),
    });
  }

  return resultado;
}

// ---------------------------------------------------------------------
// Log, leads e freio
// ---------------------------------------------------------------------
export async function registrarEntrega(
  igUserId: string, automationId: string | null, canal: string, tipo: string, status: string, motivo: string | null = null,
) {
  await db.from("ig_deliveries").insert({ ig_user_id: igUserId, automation_id: automationId, canal, tipo, status, motivo });
}

export async function salvarLead(campos: Record<string, unknown>) {
  await db.from("ig_leads").upsert(campos, { onConflict: "ig_user_id" });
}

// Pede uma ficha ao freio. Se a função não existir ou der erro: falha FECHADO.
export async function pegarFicha(): Promise<boolean> {
  const { data, error } = await db.rpc("take_send_slot", { p_key: CHAVE_FREIO });
  if (error) {
    console.error("FREIO: take_send_slot falhou (rodou o 02_freio.sql?). Envio segurado.", error.message);
    return false;
  }
  return data === true;
}

export async function registrarResultado(ok: boolean, hard: boolean) {
  const { error } = await db.rpc("record_send_result", { p_key: CHAVE_FREIO, p_ok: ok, p_hard: hard });
  if (error) console.error("FREIO: record_send_result falhou:", error.message);
}

// Envia a Mensagem 1 por resposta privada a um comentário (já com a ficha na mão).
export async function enviarPrimeiroPassoPorComentario(
  auto: Automacao, commentId: string, igUserId: string,
): Promise<ResultadoEnvio> {
  const p0 = primeiroPasso(auto);
  if (!p0) return { ok: false, hard: false, formato: "", motivo: "automação sem mensagem" };
  const r = await sendStep(auto, p0, { comment_id: commentId }, igUserId);
  await registrarResultado(r.ok, r.hard);
  const tipo = botoesValidos(p0).some((b) => b.url) ? "link" : "flow";
  await registrarEntrega(igUserId, auto.id, "private_reply", tipo, r.ok ? "ok" : "erro", r.motivo);
  return r;
}
