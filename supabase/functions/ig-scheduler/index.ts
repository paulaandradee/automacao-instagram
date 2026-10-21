// =====================================================================
// ig-scheduler: O CARTEIRO. Roda a cada 1 minuto (pg_cron).
// 1) Esvazia a fila do freio (ig_send_queue).
// 2) Manda os passos com atraso que já venceram (ig_scheduled).
// Protegido pelo header x-sched-key = SCHED_SECRET.
//
// Publicar:  supabase functions deploy ig-scheduler --no-verify-jwt
// =====================================================================
import { checarSched, db, json } from "../_shared/comum.ts";
import {
  acharPasso,
  buscarAutomacao,
  enviarPrimeiroPassoPorComentario,
  pegarFicha,
  registrarEntrega,
  salvarLead,
  sendStep,
} from "../_shared/instagram.ts";

const SETE_DIAS = 7 * 24 * 3600 * 1000; // resposta a comentário só vale ~7 dias
const MAX_TENTATIVAS = 3;

async function esvaziarFila() {
  const resumo = { enviados: 0, erros: 0, expirados: 0, sem_ficha: false };
  const { data: itens } = await db.from("ig_send_queue")
    .select("*").eq("status", "pendente").order("created_at", { ascending: true }).limit(20);

  for (const item of itens ?? []) {
    // Comentário velho demais: o Instagram não deixa mais responder.
    if (Date.now() - new Date(item.created_at).getTime() > SETE_DIAS) {
      await db.from("ig_send_queue").update({ status: "expirado" }).eq("id", item.id);
      resumo.expirados++;
      continue;
    }

    if (!(await pegarFicha())) {
      resumo.sem_ficha = true;
      break; // sem ficha agora: tenta no próximo minuto
    }

    const auto = await buscarAutomacao(item.automation_id);
    if (!auto) {
      await db.from("ig_send_queue").update({ status: "erro", last_error: "automação apagada" }).eq("id", item.id);
      continue;
    }

    const r = await enviarPrimeiroPassoPorComentario(auto, item.comment_id, item.ig_user_id);
    const tentativas = (item.tentativas ?? 0) + 1;
    if (r.ok) {
      await db.from("ig_send_queue").update({ status: "enviado", tentativas, sent_at: new Date().toISOString() }).eq("id", item.id);
      await salvarLead({ ig_user_id: item.ig_user_id, username: item.username, last_source: "comment", automation_id: auto.id });
      resumo.enviados++;
    } else {
      await db.from("ig_send_queue").update({
        status: tentativas >= MAX_TENTATIVAS ? "erro" : "pendente",
        tentativas,
        last_error: r.motivo,
      }).eq("id", item.id);
      resumo.erros++;
      if (r.hard) break; // bloqueio: para tudo, o disjuntor cuida
    }
  }
  return resumo;
}

async function enviarAtrasados() {
  let enviados = 0;
  const { data: itens } = await db.from("ig_scheduled")
    .select("*").eq("sent", false).lte("send_at", new Date().toISOString()).order("send_at").limit(50);

  for (const item of itens ?? []) {
    // Marca antes de mandar: evita mandar duas vezes se a execução cair no meio.
    await db.from("ig_scheduled").update({ sent: true }).eq("id", item.id);
    const auto = await buscarAutomacao(item.automation_id);
    const passo = auto && acharPasso(auto, item.step_id);
    if (!auto || !passo) continue;
    const r = await sendStep(auto, passo, { id: item.ig_user_id }, item.ig_user_id);
    await registrarEntrega(item.ig_user_id, auto.id, "dm", "flow", r.ok ? "ok" : "erro", r.motivo);
    if (r.ok) enviados++;
  }
  return enviados;
}

Deno.serve(async (req) => {
  if (!checarSched(req)) return json({ erro: "não autorizado" }, 401);
  try {
    const fila = await esvaziarFila();
    const atrasados = await enviarAtrasados();
    return json({ ok: true, fila, atrasados });
  } catch (e) {
    console.error(e);
    return json({ ok: false, erro: String(e) }, 500);
  }
});
