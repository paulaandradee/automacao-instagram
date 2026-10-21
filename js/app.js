// =====================================================================
// app.js: login, menu, navegação e as telas Início, Calendário e Instagram.
// O editor de automação fica em editor.js.
// =====================================================================

// ---------- Utilidades ----------
const $ = (seletor, raiz = document) => raiz.querySelector(seletor);

// Escapa texto antes de pôr no HTML (evita quebrar a tela com < > etc.)
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const fmtNum = (n) => Number(n || 0).toLocaleString("pt-BR");

let timerToast = null;
function toast(mensagem, tipo = "") {
  const t = $("#toast");
  t.textContent = mensagem;
  t.className = "toast " + tipo;
  t.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => (t.hidden = true), 3800);
}

const ICONES = {
  calendario: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  grafico: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/></svg>',
  robo: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/></svg>',
  mais: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
};

// =====================================================================
// LOGIN
// =====================================================================
function mostrarLogin() {
  Editor.fecharSemPerguntar();
  $("#app").hidden = true;
  $("#tela-login").hidden = false;
  $("#login-aviso-local").hidden = !Dados.MODO_LOCAL;
  $("#login-senha").value = "";
  $("#login-email").focus();
}

$("#form-login").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const erro = $("#login-erro");
  const botao = $("#btn-entrar");
  erro.hidden = true;
  botao.disabled = true;
  botao.textContent = "Entrando...";
  try {
    const sessao = await Dados.entrar($("#login-email").value, $("#login-senha").value);
    abrirApp(sessao);
  } catch (e) {
    erro.textContent = e.message;
    erro.hidden = false;
  } finally {
    botao.disabled = false;
    botao.textContent = "Entrar";
  }
});

$("#btn-sair").addEventListener("click", async () => {
  if (Editor.estaAberto() && !Editor.fechar()) return;
  await Dados.sair();
  location.hash = "";
  mostrarLogin();
});

$("#btn-menu").addEventListener("click", () => $("#menu").classList.toggle("aberto"));

// =====================================================================
// SHELL E NAVEGAÇÃO (por #hash, sem recarregar a página)
// =====================================================================
function abrirApp(sessao) {
  $("#tela-login").hidden = true;
  $("#app").hidden = false;
  $("#menu-usuario").textContent = sessao.email;
  $("#faixa-local").hidden = !Dados.MODO_LOCAL;
  if (!location.hash) location.hash = "#inicio";
  else rotear();
}

function rotear() {
  if ($("#app").hidden) return;
  const [rota, sub] = location.hash.replace("#", "").split("/");
  const valida = ["inicio", "calendario", "instagram"].includes(rota) ? rota : "inicio";
  document.querySelectorAll(".menu-item").forEach((a) => a.classList.toggle("ativo", a.dataset.rota === valida));
  $("#menu").classList.remove("aberto");
  window.scrollTo(0, 0);
  if (valida === "inicio") telaInicio();
  else if (valida === "calendario") telaCalendario();
  else telaInstagram(sub === "automacoes" ? "automacoes" : "metricas");
}
window.addEventListener("hashchange", rotear);

// =====================================================================
// INÍCIO
// =====================================================================
async function telaInicio() {
  const vista = $("#vista");
  const cartao = (rotulo, id, sub) => `
    <div class="cartao">
      <span class="rotulo">${rotulo}</span>
      <div class="numero" id="${id}">...</div>
      <div class="numero-sub">${sub}</div>
    </div>`;
  vista.innerHTML = `
    <div class="cabecalho">
      <div>
        <h1>Bem-vindo ao seu painel</h1>
        <p class="texto-sec">Uma visão rápida das suas automações e contatos.</p>
      </div>
    </div>
    <div class="grade grade-3">
      ${cartao("Leads captados", "n-leads", "Pessoas que interagiram")}
      ${cartao("Automações ativas", "n-ativas", "Respondendo agora")}
      ${cartao("DMs enviadas", "n-dms", "Nos últimos 7 dias")}
    </div>
    <div class="cartao" style="margin-top:16px">
      <h2>Atalhos</h2>
      <p class="texto-sec" style="margin-top:4px">Vá direto pra onde precisa.</p>
      <div class="atalhos">
        <a class="btn btn-primario" href="#instagram/automacoes">${ICONES.mais} Nova automação</a>
        <a class="btn" href="#instagram">Ver métricas do Instagram</a>
        <a class="btn" href="#calendario">Calendário</a>
      </div>
    </div>`;

  const r = await Dados.resumo();
  if (!$("#n-leads")) return; // a pessoa já mudou de tela
  $("#n-leads").textContent = fmtNum(r.leads);
  $("#n-ativas").textContent = fmtNum(r.ativas);
  $("#n-dms").textContent = fmtNum(r.dms7);
}

// =====================================================================
// CALENDÁRIO (placeholder)
// =====================================================================
function telaCalendario() {
  $("#vista").innerHTML = `
    <div class="cartao vazio" style="margin-top:8px">
      <div class="icone-grande">${ICONES.calendario}</div>
      <h1>Calendário</h1>
      <p>Essa área vai chegar em breve pra você planejar seus conteúdos.</p>
      <span class="chip" style="margin-top:16px">Em breve</span>
    </div>`;
}

// =====================================================================
// INSTAGRAM
// =====================================================================
function telaInstagram(sub) {
  $("#vista").innerHTML = `
    <div class="cabecalho">
      <div>
        <h1>Instagram</h1>
        <p class="texto-sec">Métricas da conta e respostas automáticas no direct.</p>
      </div>
      ${sub === "automacoes" ? `<button class="btn btn-primario" id="btn-nova">${ICONES.mais} Nova automação</button>` : ""}
    </div>
    <nav class="abas">
      <a class="aba ${sub === "metricas" ? "ativa" : ""}" href="#instagram/metricas">Métricas</a>
      <a class="aba ${sub === "automacoes" ? "ativa" : ""}" href="#instagram/automacoes">Automações</a>
    </nav>
    <div id="sub-vista"></div>`;

  if (sub === "automacoes") {
    $("#btn-nova").addEventListener("click", () => Editor.abrir(null, telaAutomacoes));
    telaAutomacoes();
  } else {
    telaMetricas();
  }
}

// ---------- Métricas ----------
function grafico(serie) {
  if (!serie || !serie.length) return `<p class="dica">Sem dados de série pra esse período ainda.</p>`;
  const max = Math.max(1, ...serie.map((p) => p.valor));
  const dia = (d) => d.slice(8, 10) + "/" + d.slice(5, 7);
  return `
    <div class="barras">
      ${serie.map((p) => `<div class="barra" style="height:${Math.max(2, (p.valor / max) * 100)}%" data-tip="${dia(p.data)}: ${fmtNum(p.valor)}"></div>`).join("")}
    </div>
    <div class="barras-eixo"><span>${dia(serie[0].data)}</span><span>${dia(serie[serie.length - 1].data)}</span></div>`;
}

async function telaMetricas() {
  const alvo = $("#sub-vista");
  alvo.innerHTML = `<p class="texto-sec">Carregando métricas...</p>`;
  const [dados, leads] = await Promise.all([Dados.chamarFuncao("ig-insights"), Dados.contarLeads()]);
  if (!$("#sub-vista")) return;

  const cartaoLeads = `
    <div class="cartao">
      <span class="rotulo">Leads captados</span>
      <div class="numero">${fmtNum(leads)}</div>
      <div class="numero-sub">Total no banco</div>
    </div>`;

  if (!dados || !dados.conectado) {
    alvo.innerHTML = `
      <div class="grade grade-3" style="margin-bottom:16px">${cartaoLeads}</div>
      <div class="cartao vazio">
        <div class="icone-grande">${ICONES.grafico}</div>
        <h2>Conecte seu Instagram pra ver as métricas</h2>
        <p>Quando o token do Instagram estiver configurado nas Edge Functions, aqui aparecem seguidores, novos seguidores por dia e alcance. O passo a passo está no LEIA-ME.</p>
      </div>`;
    return;
  }

  const somaNovos = (dados.novos_seguidores || []).reduce((s, p) => s + p.valor, 0);
  alvo.innerHTML = `
    <div class="grade grade-3" style="margin-bottom:16px">
      <div class="cartao">
        <span class="rotulo">Seguidores</span>
        <div class="numero">${fmtNum(dados.seguidores)}</div>
        <div class="numero-sub">@${esc(dados.username)}</div>
      </div>
      <div class="cartao">
        <span class="rotulo">Novos seguidores</span>
        <div class="numero">${fmtNum(somaNovos)}</div>
        <div class="numero-sub">Últimos 15 dias</div>
      </div>
      ${cartaoLeads}
    </div>
    <div class="grade grade-2">
      <div class="cartao">
        <h3>Novos seguidores por dia</h3>
        <p class="dica" style="margin-top:2px">Passe o mouse nas barras pra ver o número de cada dia.</p>
        ${grafico(dados.novos_seguidores)}
      </div>
      <div class="cartao">
        <h3>Alcance por dia</h3>
        <p class="dica" style="margin-top:2px">Contas únicas que viram seu conteúdo.</p>
        ${grafico(dados.alcance)}
      </div>
    </div>`;
}

// ---------- Automações (lista) ----------
async function telaAutomacoes() {
  const alvo = $("#sub-vista");
  if (!alvo) return;
  alvo.innerHTML = `<p class="texto-sec">Carregando automações...</p>`;
  const lista = await Dados.listarAutomacoes();
  if (!$("#sub-vista")) return;

  if (!lista.length) {
    alvo.innerHTML = `
      <div class="cartao vazio">
        <div class="icone-grande">${ICONES.robo}</div>
        <h2>Nenhuma automação ainda</h2>
        <p>Crie a primeira: quando alguém comentar uma palavra no seu post, a pessoa recebe uma mensagem no direct na hora.</p>
        <button class="btn btn-primario" id="btn-nova-vazio">${ICONES.mais} Nova automação</button>
      </div>`;
    $("#btn-nova-vazio").addEventListener("click", () => Editor.abrir(null, telaAutomacoes));
    return;
  }

  const descreverModo = (a) => {
    const modo = a.flow?.modo;
    const passos = (a.flow?.steps || []).length;
    if (modo === "link") return "Botão com link";
    if (modo === "conversa") return `Conversa com ${passos} mensagens`;
    return "Só mensagem";
  };

  alvo.innerHTML = `<div class="lista">${lista.map((a) => `
    <div class="item-auto" data-id="${esc(a.id)}">
      <div class="info">
        <h3>${esc(a.nome || "Automação sem nome")}</h3>
        <div class="meta">
          ${a.match_any
            ? `<span class="chip chip-destaque">Qualquer palavra</span>`
            : (a.keyword || "").split(",").filter((k) => k.trim()).map((k) => `<span class="chip chip-destaque">${esc(k.trim())}</span>`).join("")}
          <span class="chip">${descreverModo(a)}</span>
          <span class="chip">${(a.media_ids || []).length ? `${a.media_ids.length} post(s)` : "Todos os posts"}</span>
        </div>
      </div>
      <div class="acoes">
        <label class="switch" title="Ligar ou desligar">
          <input type="checkbox" data-alternar ${a.active ? "checked" : ""}>
          <span class="trilho"></span>
          <span class="texto-sec" style="font-size:13px">${a.active ? "Ligada" : "Desligada"}</span>
        </label>
        <button class="btn btn-pequeno" data-editar>Editar</button>
        <button class="btn btn-pequeno btn-perigo" data-apagar>Apagar</button>
      </div>
    </div>`).join("")}</div>`;

  alvo.querySelectorAll(".item-auto").forEach((linha) => {
    const auto = lista.find((a) => String(a.id) === linha.dataset.id);
    $("[data-editar]", linha).addEventListener("click", () => Editor.abrir(auto, telaAutomacoes));
    $("[data-apagar]", linha).addEventListener("click", async () => {
      if (!confirm(`Apagar a automação "${auto.nome || "sem nome"}"? Isso não pode ser desfeito.`)) return;
      try {
        await Dados.excluirAutomacao(auto.id);
        toast("Automação apagada.", "sucesso");
        telaAutomacoes();
      } catch (e) {
        toast(e.message, "erro");
      }
    });
    $("[data-alternar]", linha).addEventListener("change", async (ev) => {
      try {
        await Dados.definirAtiva(auto.id, ev.target.checked);
        ev.target.parentElement.querySelector(".texto-sec").textContent = ev.target.checked ? "Ligada" : "Desligada";
        toast(ev.target.checked ? "Automação ligada." : "Automação desligada.");
      } catch (e) {
        ev.target.checked = !ev.target.checked;
        toast(e.message, "erro");
      }
    });
  });
}

// =====================================================================
// INÍCIO DO APP
// =====================================================================
(async function iniciar() {
  Dados.aoPerderSessao(() => {
    if (!$("#app").hidden) {
      toast("Sua sessão expirou. Entre de novo.");
      mostrarLogin();
    }
  });
  const sessao = await Dados.sessaoAtual();
  if (sessao) abrirApp(sessao);
  else mostrarLogin();
})();
