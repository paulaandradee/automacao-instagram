// =====================================================================
// editor.js: o editor visual de automação (o "ManyChat").
//
// BLOCO 1: o gatilho (palavras, posts, resposta no comentário).
// BLOCO 2: a resposta (Mensagem 1, botão, link ou conversa, arquivos).
// Ao lado: a prévia ao vivo num mockup de celular.
//
// O editor trabalha com um "estado" simples (st) e, ao salvar, converte
// tudo pro formato "flow" (veja a seção 7 do prompt / LEIA-ME):
//   flow.steps[0] = Mensagem 1 (Sua mensagem + Texto do botão)
//   flow.steps[1..] = Mensagem 2, 3...
// =====================================================================
const Editor = (() => {
  const EMOJIS = ["🫶", "👀", "😍", "🥰", "😂", "😮", "🔥", "✨", "💌", "👉", "🙌", "💕"];
  const LIMITE_TITULO = 20; // o Instagram corta o nome do botão em 20 caracteres
  const MAX_BOTOES = 13;    // anexados: até 3; acima disso vira pílula (até 13)
  const ICONE_LINK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

  let st = null;          // estado do editor
  let sujo = false;       // tem alteração não salva?
  let aoSalvar = null;    // callback depois de salvar
  let posts = null;       // null = carregando, false = sem conexão, [] = lista
  let arquivos = null;    // biblioteca de arquivos

  const raiz = () => document.getElementById("editor");

  // -------------------------------------------------------------------
  // Estado <-> automação salva
  // -------------------------------------------------------------------
  function estadoNovo() {
    return {
      id: null, nome: "", active: true,
      keywords: [], match_any: false, media_ids: [],
      public_reply: "", variantes: [],
      mensagem: "", botaoAtivo: true, botaoTexto: "", modo: "link", link: "",
      passos: [], assets: [], proximoId: 2,
    };
  }

  function deAutomacao(a) {
    const s = estadoNovo();
    s.id = a.id;
    s.nome = a.nome || "";
    s.active = a.active !== false;
    s.keywords = (a.keyword || "").split(",").map((t) => t.trim()).filter(Boolean);
    s.match_any = !!a.match_any;
    s.media_ids = [...(a.media_ids || [])];
    s.public_reply = a.public_reply || "";
    s.variantes = [...(a.public_reply_variants || [])];

    const steps = a.flow?.steps || [];
    const p0 = steps[0];
    if (p0) {
      s.mensagem = p0.message || "";
      s.assets = [...(p0.assets || a.asset_ids || [])];
      const b = (p0.buttons || [])[0];
      s.botaoAtivo = !!b;
      if (b) {
        s.botaoTexto = b.title || "";
        s.modo = "url" in b ? "link" : "conversa";
        s.link = b.url || "";
      }
      if (a.flow?.modo === "link" || a.flow?.modo === "conversa") s.modo = a.flow.modo;
    }
    s.passos = steps.slice(1).map((p) => ({
      id: Number(p.id),
      message: p.message || "",
      buttons: (p.buttons || []).map((b) => ({
        title: b.title || "",
        url: b.url || "",
        next: b.next ?? null,
        isLink: "url" in b, // a escolha "é link" tem estado próprio
      })),
      acao: p.collect
        ? { tipo: p.collect.field, next: p.collect.next ?? null, seconds: 30 }
        : p.delay
          ? { tipo: "atraso", next: p.delay.next ?? null, seconds: p.delay.seconds || 30 }
          : { tipo: "nenhuma", next: null, seconds: 30 },
    }));
    s.proximoId = Math.max(1, ...s.passos.map((p) => p.id)) + 1;
    return s;
  }

  function paraAutomacao() {
    // Mensagem 1 = "Sua mensagem" + "Texto do botão".
    const p0 = { id: 1, message: st.mensagem.trim(), buttons: [], assets: [...st.assets] };
    if (st.botaoAtivo) {
      const title = st.botaoTexto.trim();
      if (st.modo === "link") p0.buttons.push({ title, url: st.link.trim() });
      else p0.buttons.push({ title, next: st.passos[0]?.id ?? null });
    }

    const demais = st.passos.map((p) => {
      const passo = {
        id: p.id,
        message: p.message.trim(),
        buttons: p.buttons.map((b) => {
          const title = b.title.trim();
          if (b.isLink) return { title, url: b.url.trim() };
          if (b.next !== null && b.next !== undefined) return { title, next: b.next };
          return { title }; // "encerrar": não é enviado
        }),
      };
      if (p.acao.tipo === "email" || p.acao.tipo === "telefone") {
        passo.collect = { field: p.acao.tipo, next: p.acao.next ?? null };
      }
      if (p.acao.tipo === "atraso" && p.acao.next !== null) {
        passo.delay = { seconds: Math.max(5, Number(p.acao.seconds) || 30), next: p.acao.next };
      }
      return passo;
    });

    return {
      ...(st.id ? { id: st.id } : {}),
      nome: st.nome.trim() || "Automação sem nome",
      keyword: st.keywords.join(", "),
      match_any: st.match_any,
      active: st.active,
      media_ids: [...st.media_ids],
      public_reply: st.public_reply.trim(),
      public_reply_variants: st.variantes.map((v) => v.trim()).filter(Boolean),
      flow: { modo: st.botaoAtivo ? st.modo : "sem_botao", steps: [p0, ...demais] },
      asset_ids: [...st.assets],
    };
  }

  // -------------------------------------------------------------------
  // Links
  // -------------------------------------------------------------------
  const linkValido = (s) => /^https?:\/\/[^\s.]+\.\S+/i.test((s || "").trim());

  function pareceLink(s) {
    const v = (s || "").trim();
    if (!v || /\s/.test(v)) return false;
    return /^https?:\/\//i.test(v) || /^www\./i.test(v) || /^[\w-]+(\.[\w-]+)+\/\S*$/.test(v);
  }
  const normalizarLink = (v) => (/^https?:\/\//i.test(v) ? v : "https://" + v);

  // Se colaram o link no NOME do botão, move pro campo do link e põe "Acessar".
  function corrigirLinkNoNome(obj, campoTitulo, campoLink) {
    if (!pareceLink(obj[campoTitulo])) return false;
    if (!obj[campoLink].trim()) obj[campoLink] = normalizarLink(obj[campoTitulo].trim());
    obj[campoTitulo] = "Acessar";
    toast('Movi o link pro campo do link. O nome do botão ficou "Acessar".');
    return true;
  }

  // -------------------------------------------------------------------
  // Abrir / fechar
  // -------------------------------------------------------------------
  function abrir(automacao, callback) {
    st = automacao ? deAutomacao(automacao) : estadoNovo();
    sujo = false;
    aoSalvar = callback;
    posts = null;
    arquivos = null;
    raiz().hidden = false;
    document.body.style.overflow = "hidden";
    renderizar();
    if (!automacao) focar(".ed-nome");
    carregarPosts();
    carregarArquivos();
  }

  // Retorna true se fechou.
  function fechar() {
    if (sujo && !confirm("Você tem alterações não salvas. Sair mesmo assim e perder o que mudou?")) return false;
    fecharSemPerguntar();
    return true;
  }

  function fecharSemPerguntar() {
    const r = raiz();
    if (!r) return;
    r.hidden = true;
    r.innerHTML = "";
    st = null;
    sujo = false;
    document.body.style.overflow = "";
  }

  const estaAberto = () => !!st;
  const marcarSujo = () => (sujo = true);

  function focar(seletor) {
    const el = raiz().querySelector(seletor);
    if (el) el.focus();
  }

  // -------------------------------------------------------------------
  // Carregamentos assíncronos (posts e arquivos)
  // -------------------------------------------------------------------
  async function carregarPosts() {
    if (!Dados.temBanco()) {
      posts = false;
    } else {
      const r = await Dados.chamarFuncao("ig-media");
      posts = r && r.conectado ? r.posts || [] : false;
    }
    if (!st) return;
    const el = document.getElementById("ed-posts");
    if (el) el.innerHTML = htmlPosts();
  }

  async function carregarArquivos() {
    arquivos = Dados.temBanco() ? await Dados.listarArquivos() : [];
    if (!st) return;
    atualizarArquivos();
    atualizarPrevia();
  }

  function atualizarArquivos() {
    const el = document.getElementById("ed-arquivos");
    if (el) el.innerHTML = htmlArquivos();
  }

  async function enviarArquivo(file) {
    if (!file) return;
    toast("Enviando arquivo...");
    try {
      const novo = await Dados.enviarArquivo(file);
      arquivos = [novo, ...(arquivos || [])];
      st.assets.push(novo.id);
      marcarSujo();
      atualizarArquivos();
      atualizarPrevia();
      toast("Arquivo enviado e anexado.", "sucesso");
    } catch (e) {
      toast(e.message, "erro");
    }
  }

  // -------------------------------------------------------------------
  // HTML do editor
  // -------------------------------------------------------------------
  const contador = (texto) => {
    const n = (texto || "").trim().length;
    return `<span class="${n > LIMITE_TITULO ? "estourou" : ""}">${n}/${LIMITE_TITULO}</span>`;
  };

  const barraEmojis = (alvoId) => `
    <div class="emojis" aria-label="Inserir emoji">
      ${EMOJIS.map((e) => `<button type="button" data-acao="emoji" data-alvo="${alvoId}" data-emoji="${e}" title="Inserir ${e}">${e}</button>`).join("")}
    </div>`;

  function renderizar() {
    const corpoAntigo = raiz().querySelector(".ed-corpo");
    const rolagem = corpoAntigo ? corpoAntigo.scrollTop : 0;

    let aviso = "";
    if (Dados.MODO_LOCAL) {
      aviso = `<div class="alerta alerta-atencao">Modo de teste local: ao salvar, a automação fica guardada só neste navegador. Pra salvar de verdade e o robô responder no Instagram, configure o Supabase pelo LEIA-ME.</div>`;
    } else if (!Dados.temBanco()) {
      aviso = `<div class="alerta alerta-atencao">O Supabase ainda não foi configurado: dá pra montar e ver a prévia, mas salvar só funciona depois de seguir o LEIA-ME.</div>`;
    }

    raiz().innerHTML = `
      <div class="ed-topo">
        <button type="button" class="btn btn-fantasma" data-acao="fechar">← Voltar</button>
        <input type="text" class="ed-nome" data-campo="nome" value="${esc(st.nome)}" placeholder="Nome da automação (ex: Guia gratuito)" aria-label="Nome da automação">
        <span class="espaco"></span>
        <label class="switch"><input type="checkbox" data-campo="active" ${st.active ? "checked" : ""}><span class="trilho"></span>Ativa</label>
        <button type="button" class="btn btn-primario" data-acao="salvar" id="ed-salvar">Salvar</button>
      </div>
      <div class="ed-corpo">
        <div class="ed-grade">
          <div class="ed-form">
            <div id="ed-erros"></div>
            ${aviso}
            ${blocoGatilho()}
            ${blocoResposta()}
          </div>
          <aside class="ed-previa">
            <div class="celular">
              <div class="cel-topo">
                <div class="cel-avatar"></div>
                <div><b>sua_conta</b><small>Instagram</small></div>
              </div>
              <div class="cel-chat" id="ed-previa"></div>
            </div>
            <p class="dica" style="text-align:center">Prévia ao vivo: é assim que a DM chega.</p>
          </aside>
        </div>
      </div>`;

    atualizarPrevia();
    raiz().querySelector(".ed-corpo").scrollTop = rolagem;
  }

  // ---------- BLOCO 1: o gatilho ----------
  function blocoGatilho() {
    return `
      <section class="bloco">
        <div class="bloco-cab">
          <span class="bloco-num">1</span>
          <div><h2>O gatilho</h2><p>O que faz a DM disparar.</p></div>
        </div>
        <div class="bloco-corpo">
          <div>
            <span class="secao-titulo">Palavras que ativam</span>
            <div class="tags ${st.match_any ? "desligado" : ""}" data-foco-tags>
              ${st.keywords.map((k, i) => `<span class="tag">${esc(k)}<button type="button" data-acao="rm-tag" data-i="${i}" aria-label="Remover ${esc(k)}">×</button></span>`).join("")}
              <input type="text" id="ed-tag-input" placeholder="${st.keywords.length ? "Adicionar outra" : "Digite uma palavra e aperte Enter"}" aria-label="Nova palavra">
            </div>
            <p class="dica">Aperte Enter pra adicionar cada palavra. Maiúscula, minúscula e acento não importam.</p>
            <label class="switch" style="margin-top:12px">
              <input type="checkbox" data-campo="match_any" ${st.match_any ? "checked" : ""}><span class="trilho"></span>
              Qualquer palavra ativa (todo comentário no post dispara)
            </label>
          </div>

          <div>
            <span class="secao-titulo">Em quais posts</span>
            <div id="ed-posts">${htmlPosts()}</div>
          </div>

          <div>
            <span class="secao-titulo">Resposta no comentário</span>
            <input type="text" data-campo="public_reply" value="${esc(st.public_reply)}" placeholder="Ex: Te chamei no direct 💌">
            ${st.variantes.map((v, i) => `
              <div class="linha">
                <input type="text" data-variante="${i}" value="${esc(v)}" placeholder="Variação ${i + 2} (ex: Olha seu direct 👀)">
                <button type="button" class="btn btn-pequeno btn-fantasma" data-acao="rm-variante" data-i="${i}">Remover</button>
              </div>`).join("")}
            <p class="dica">Texto público que responde quem comentou. Com variações (A/B), o sistema alterna entre elas.</p>
            <button type="button" class="btn btn-pequeno" data-acao="add-variante" style="margin-top:8px">+ Adicionar variação</button>
          </div>
        </div>
      </section>`;
  }

  function htmlPosts() {
    const marcados = st.media_ids.length;
    if (posts === null) return `<p class="dica">Carregando seus posts...</p>`;
    if (posts === false) {
      return `<div class="alerta alerta-info" style="margin:0">Conecte seu Instagram pra escolher os posts. Enquanto isso, a automação vale pra todos os posts.${marcados ? ` (${marcados} post(s) já marcados.)` : ""}</div>`;
    }
    if (!posts.length) return `<p class="dica">Nenhum post encontrado. A automação vale pra todos os posts.</p>`;
    return `
      <p class="dica" style="margin:0 0 8px">${marcados ? `${marcados} post(s) selecionado(s). <a href="#" data-acao="todos-posts">Limpar (valer pra todos)</a>` : "Nenhum marcado = vale pra todos os posts."}</p>
      <div class="posts">
        ${posts.map((p) => `
          <button type="button" class="post ${st.media_ids.includes(p.id) ? "marcado" : ""}" data-acao="post" data-id="${esc(p.id)}" title="${esc(p.legenda || "Post")}">
            ${p.miniatura ? `<img src="${esc(p.miniatura)}" alt="" loading="lazy">` : ""}
          </button>`).join("")}
      </div>`;
  }

  // ---------- BLOCO 2: a resposta ----------
  function blocoResposta() {
    let parteBotao = "";
    if (st.botaoAtivo) {
      parteBotao = `
        <div>
          <span class="secao-titulo">Texto do botão</span>
          <input type="text" data-campo="botaoTexto" value="${esc(st.botaoTexto)}" placeholder="Ex: Quero receber">
          <div class="contador" id="ed-cont-principal">${contador(st.botaoTexto)}</div>
        </div>
        <div>
          <span class="secao-titulo">O que o botão faz quando ela toca</span>
          <div class="opcoes">
            <label class="opcao">
              <input type="radio" name="ed-modo" value="link" data-campo="modo" ${st.modo === "link" ? "checked" : ""}>
              <div><strong>Um link</strong><span>Ao tocar, a pessoa é levada pra um site.</span></div>
            </label>
            <label class="opcao">
              <input type="radio" name="ed-modo" value="conversa" data-campo="modo" ${st.modo === "conversa" ? "checked" : ""}>
              <div><strong>Continua a conversa</strong><span>Ela te envia o texto do botão e a conversa segue.</span></div>
            </label>
          </div>
        </div>
        ${st.modo === "link" ? `
          <div>
            <span class="secao-titulo">Link do botão</span>
            <textarea class="campo-link" data-campo="link" placeholder="https://seusite.com/pagina?pode=ser&um=link=bem+grande">${esc(st.link)}</textarea>
            <p class="dica">Cole aqui o link completo, sem limite de tamanho. A pessoa vê só o nome do botão; o link fica invisível.</p>
          </div>` : construtor()}`;
    }

    return `
      <section class="bloco">
        <div class="bloco-cab">
          <span class="bloco-num">2</span>
          <div><h2>A resposta</h2><p>O que a pessoa recebe na DM.</p></div>
        </div>
        <div class="bloco-corpo">
          <div>
            <span class="secao-titulo">Sua mensagem</span>
            ${barraEmojis("ed-msg")}
            <textarea id="ed-msg" data-campo="mensagem" rows="4" placeholder="Oi! Que bom que você comentou 🥰 Toca no botão aqui embaixo que eu te mando.">${esc(st.mensagem)}</textarea>
            <p class="dica">Essa é a Mensagem 1, a primeira que a pessoa recebe.</p>
          </div>
          <div>
            <label class="switch">
              <input type="checkbox" data-campo="botaoAtivo" ${st.botaoAtivo ? "checked" : ""}><span class="trilho"></span>
              Botão na mensagem
            </label>
          </div>
          ${parteBotao}
          <div>
            <span class="secao-titulo">Anexar um arquivo (opcional)</span>
            <div id="ed-arquivos">${htmlArquivos()}</div>
          </div>
        </div>
      </section>`;
  }

  // ---------- Construtor de sequência (mini-chat) ----------
  function construtor() {
    const destinoP0 = st.passos.length ? "vai pra Mensagem 2" : "adicione a Mensagem 2 abaixo";
    return `
      <div>
        <span class="secao-titulo">A conversa</span>
        <div class="seq">
          <div class="seq-ref">
            <span class="rotulo">Mensagem 1 (edite lá em cima)</span>
            <p id="ed-ref-msg">${st.mensagem.trim() ? esc(st.mensagem) : '<span class="texto-sec">Escreva "Sua mensagem" lá em cima.</span>'}</p>
            <div class="meta" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
              <span class="chip chip-destaque" id="ed-ref-botao">${esc(st.botaoTexto.trim() || "Texto do botão")}</span>
              <span class="chip">${destinoP0}</span>
            </div>
          </div>
          ${st.passos.map(htmlPasso).join("")}
          <button type="button" class="btn" data-acao="add-passo">+ Adicionar mensagem</button>
        </div>
      </div>`;
  }

  function htmlPasso(p, i) {
    const n = i + 2;
    const outros = st.passos.map((o, k) => ({ id: o.id, n: k + 2 })).filter((o) => o.id !== p.id);
    const opcoesPassos = (selecionado, vazio) =>
      (vazio ? `<option value="" ${selecionado == null ? "selected" : ""}>${vazio}</option>` : "") +
      outros.map((o) => `<option value="${o.id}" ${selecionado === o.id ? "selected" : ""}>Mensagem ${o.n}</option>`).join("");

    const a = p.acao;
    let extra = "";
    if (a.tipo === "atraso") {
      extra = `
        <span class="texto-sec" style="font-size:13px">depois de</span>
        <input type="number" min="5" step="5" data-p="${i}" data-extra="seconds" value="${esc(a.seconds)}" aria-label="Segundos">
        <span class="texto-sec" style="font-size:13px">segundos, enviar a</span>
        <select data-p="${i}" data-extra="next">${opcoesPassos(a.next, "(escolha)")}</select>`;
    } else if (a.tipo === "email" || a.tipo === "telefone") {
      extra = `
        <span class="texto-sec" style="font-size:13px">e depois enviar a</span>
        <select data-p="${i}" data-extra="next">${opcoesPassos(a.next, "(nenhuma, só agradecer)")}</select>`;
    }

    return `
      <div class="passo">
        <div class="passo-cab">
          <h3><span class="bloco-num">${n}</span> Mensagem ${n}</h3>
          <button type="button" class="btn btn-pequeno btn-fantasma" data-acao="rm-passo" data-p="${i}">Remover</button>
        </div>
        ${barraEmojis("ed-passo-" + p.id)}
        <textarea id="ed-passo-${p.id}" data-p="${i}" data-cp="message" rows="3" placeholder="Escreva a Mensagem ${n}">${esc(p.message)}</textarea>

        ${p.buttons.map((b, j) => htmlBotao(p, i, b, j, outros)).join("")}
        ${p.buttons.length < MAX_BOTOES ? `<button type="button" class="btn btn-pequeno" data-acao="add-botao" data-p="${i}" style="margin-top:10px">+ Adicionar botão</button>` : ""}
        ${p.buttons.length > 3 ? `<p class="dica">Com mais de 3 botões, o Instagram não deixa anexar ao balão: eles vão como pílulas de resposta rápida (e os links viram texto na mensagem).</p>` : ""}

        <div class="extra">
          <span class="texto-sec" style="font-size:13px">Depois desta mensagem:</span>
          <select data-p="${i}" data-extra="tipo">
            <option value="nenhuma" ${a.tipo === "nenhuma" ? "selected" : ""}>Esperar o toque num botão</option>
            <option value="email" ${a.tipo === "email" ? "selected" : ""}>Pedir o e-mail</option>
            <option value="telefone" ${a.tipo === "telefone" ? "selected" : ""}>Pedir o telefone</option>
            <option value="atraso" ${a.tipo === "atraso" ? "selected" : ""}>Enviar outra sozinha (com atraso)</option>
          </select>
          ${extra}
        </div>
        ${a.tipo === "email" || a.tipo === "telefone" ? `<p class="dica">A próxima mensagem de texto da pessoa vira o ${a.tipo === "email" ? "e-mail" : "telefone"} salvo no contato. Se vier estranho, o sistema pede de novo. Peça o dado no texto desta mensagem.</p>` : ""}
      </div>`;
  }

  function htmlBotao(p, i, b, j, outros) {
    const destino = b.isLink ? "link" : b.next !== null && b.next !== undefined ? "p:" + b.next : "fim";
    return `
      <div class="botao-ed">
        <div class="linha">
          <input type="text" data-p="${i}" data-b="${j}" data-cb="title" value="${esc(b.title)}" placeholder="Nome do botão" aria-label="Nome do botão">
          <select data-p="${i}" data-b="${j}" data-destino aria-label="Destino do botão">
            ${outros.map((o) => `<option value="p:${o.id}" ${destino === "p:" + o.id ? "selected" : ""}>Ir pra Mensagem ${o.n}</option>`).join("")}
            <option value="link" ${destino === "link" ? "selected" : ""}>Abrir um link</option>
            <option value="fim" ${destino === "fim" ? "selected" : ""}>Encerrar</option>
          </select>
          <button type="button" class="btn-icone" data-acao="rm-botao" data-p="${i}" data-b="${j}" aria-label="Remover botão" title="Remover botão">×</button>
        </div>
        <div class="contador" id="ed-cont-${i}-${j}">${contador(b.title)}</div>
        ${b.isLink ? `
          <textarea class="campo-link" data-p="${i}" data-b="${j}" data-cb="url" placeholder="Cole o link completo aqui (https://...)">${esc(b.url)}</textarea>
          <p class="dica">O link vai aqui, nunca no nome do botão. A pessoa vê só o nome.</p>` : ""}
        ${destino === "fim" ? `<p class="dica">Encerrar não vira um botão: ele não aparece pra pessoa. A conversa termina nesta mensagem.</p>` : ""}
      </div>`;
  }

  // ---------- Arquivos ----------
  function htmlArquivos() {
    if (!Dados.temBanco()) {
      return `<p class="dica" style="margin:0">A biblioteca de arquivos (PDF, áudio, foto ou vídeo) funciona depois de configurar o Supabase. Veja o LEIA-ME.</p>`;
    }
    if (arquivos === null) return `<p class="dica" style="margin:0">Carregando biblioteca...</p>`;
    return `
      <div class="arquivos">
        ${arquivos.length ? arquivos.map((a) => `
          <label class="arquivo">
            <input type="checkbox" data-arquivo="${esc(a.id)}" ${st.assets.includes(a.id) ? "checked" : ""}>
            <span>${esc(a.nome)}</span>
            <span class="chip" style="margin-left:auto">${esc(a.tipo)}</span>
          </label>`).join("") : `<p class="dica" style="margin:0">Sua biblioteca ainda está vazia.</p>`}
      </div>
      <label class="btn btn-pequeno" style="margin-top:10px">
        Enviar novo arquivo
        <input type="file" data-upload hidden accept="image/*,audio/*,video/*,application/pdf">
      </label>
      <p class="dica">Por resposta a comentário o Instagram só deixa mandar UMA mensagem antes da pessoa responder. Por isso, os arquivos da Mensagem 1 saem quando ela tocar no botão (no modo "Continua a conversa").</p>`;
  }

  // -------------------------------------------------------------------
  // PRÉVIA AO VIVO
  // -------------------------------------------------------------------
  // Botão aparece só se tem nome E destino (igual ao que é enviado de verdade).
  function botoesVisiveisDoPasso(p) {
    return p.buttons.filter((b) => b.title.trim() && (b.isLink ? linkValido(b.url) : b.next !== null && b.next !== undefined));
  }

  function balao(texto, botoes, anexos = "") {
    return `
      <div class="msg msg-sua">
        <div class="balao">
          <div class="balao-texto">${texto.trim() ? esc(texto) : '<span style="color:#9CA3AF">(mensagem vazia)</span>'}</div>
          ${anexos}
          ${botoes.map((b) => `<div class="balao-botao">${b.link ? ICONE_LINK : ""}${esc(b.title.trim().slice(0, LIMITE_TITULO))}</div>`).join("")}
        </div>
      </div>`;
  }

  const bolhaDela = (texto) => `<div class="msg msg-dela">${esc(texto)}</div>`;

  function atualizarPrevia() {
    const alvo = document.getElementById("ed-previa");
    if (!alvo || !st) return;

    const palavra = st.match_any ? "quero" : st.keywords[0] || "palavra";
    let html = `
      <div class="cel-coment">
        <small>Comentário no seu post</small>
        <b>pessoa</b> ${esc(palavra)}
        ${st.public_reply.trim() ? `<div class="resp"><b>sua_conta</b> ${esc(st.public_reply)}</div>` : ""}
      </div>
      <div class="cel-nota">Direct</div>`;

    if (!st.mensagem.trim()) {
      alvo.innerHTML = html + `<div class="cel-vazio">Escreva "Sua mensagem" pra ver a prévia aqui.</div>`;
      return;
    }

    // Mensagem 1
    const titulo = st.botaoTexto.trim();
    let botaoP0 = null;
    if (st.botaoAtivo && titulo) {
      if (st.modo === "link" && linkValido(st.link)) botaoP0 = { title: titulo, link: true };
      if (st.modo === "conversa" && st.passos.length) botaoP0 = { title: titulo, link: false };
    }
    const nomesAnexos = st.assets
      .map((id) => (arquivos || []).find((a) => a.id === id))
      .filter(Boolean)
      .map((a) => `<div class="balao-anexo">📎 ${esc(a.nome)}</div>`)
      .join("");
    html += balao(st.mensagem, botaoP0 ? [botaoP0] : [], nomesAnexos);
    if (st.botaoAtivo && !botaoP0) html += `<div class="cel-nota">O botão aparece quando tiver nome e destino</div>`;

    // Mensagem 2 em diante (só no modo conversa)
    if (st.botaoAtivo && st.modo === "conversa") {
      st.passos.forEach((p, i) => {
        // O que levou até aqui?
        if (i === 0) {
          if (botaoP0) html += bolhaDela(titulo);
        } else {
          const origemBotao = st.passos.flatMap((o) => botoesVisiveisDoPasso(o)).find((b) => !b.isLink && b.next === p.id);
          const origemAtraso = st.passos.find((o) => o.acao.tipo === "atraso" && o.acao.next === p.id);
          if (origemBotao) html += bolhaDela(origemBotao.title.trim().slice(0, LIMITE_TITULO));
          else if (origemAtraso) html += `<div class="cel-nota">Enviada sozinha depois de ${esc(origemAtraso.acao.seconds)}s</div>`;
        }

        const visiveis = botoesVisiveisDoPasso(p).map((b) => ({ title: b.title, link: b.isLink }));
        html += balao(p.message, visiveis.length <= 3 ? visiveis : []);
        if (visiveis.length > 3) {
          html += `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end">${visiveis.filter((b) => !b.link).map((b) => `<span class="chip chip-destaque">${esc(b.title.slice(0, LIMITE_TITULO))}</span>`).join("")}</div>`;
        }

        if (p.acao.tipo === "email") html += bolhaDela("nome@email.com");
        if (p.acao.tipo === "telefone") html += bolhaDela("(11) 90000-0000");
        if (botoesVisiveisDoPasso(p).length === 0 && p.acao.tipo === "nenhuma") {
          html += `<div class="cel-nota">Fim da conversa</div>`;
        }
      });
    }

    alvo.innerHTML = html;
  }

  // -------------------------------------------------------------------
  // Ações
  // -------------------------------------------------------------------
  function adicionarTags(texto) {
    const novas = texto.split(",").map((t) => t.trim()).filter(Boolean);
    let mudou = false;
    for (const t of novas) {
      if (!st.keywords.some((k) => k.toLowerCase() === t.toLowerCase())) {
        st.keywords.push(t);
        mudou = true;
      }
    }
    return mudou;
  }

  function adicionarPasso() {
    const id = st.proximoId++;
    st.passos.push({ id, message: "", buttons: [], acao: { tipo: "nenhuma", next: null, seconds: 30 } });
    return id;
  }

  function removerPasso(i) {
    const id = st.passos[i].id;
    st.passos.splice(i, 1);
    // Ninguém pode apontar pra uma mensagem que não existe mais.
    for (const p of st.passos) {
      for (const b of p.buttons) if (b.next === id) b.next = null;
      if (p.acao.next === id) p.acao.next = null;
    }
  }

  function inserirEmoji(alvoId, emoji) {
    const ta = document.getElementById(alvoId);
    if (!ta) return;
    const ini = ta.selectionStart ?? ta.value.length;
    const fim = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, ini) + emoji + ta.value.slice(fim);
    const pos = ini + emoji.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function validar() {
    const e = [];
    if (!st.match_any && !st.keywords.length) e.push('Adicione pelo menos uma palavra que ativa, ou ligue "Qualquer palavra ativa".');
    if (!st.mensagem.trim()) e.push('Escreva "Sua mensagem" (a Mensagem 1).');
    if (st.botaoAtivo) {
      const t = st.botaoTexto.trim();
      if (!t) e.push('Dê um nome pro botão ("Texto do botão").');
      else if (t.length > LIMITE_TITULO) e.push(`O texto do botão passou de ${LIMITE_TITULO} caracteres (o Instagram corta o resto).`);
      if (st.modo === "link" && !linkValido(st.link)) e.push("Cole o link completo do botão (começando com https://).");
      if (st.modo === "conversa" && !st.passos.length) e.push("Adicione a Mensagem 2 da conversa.");
    }
    if (st.botaoAtivo && st.modo === "conversa") {
      st.passos.forEach((p, i) => {
        const n = i + 2;
        if (!p.message.trim()) e.push(`A Mensagem ${n} está vazia.`);
        p.buttons.forEach((b, j) => {
          const nome = b.title.trim();
          const temDestino = b.isLink || (b.next !== null && b.next !== undefined);
          if (temDestino && !nome) e.push(`Mensagem ${n}: o botão ${j + 1} está sem nome.`);
          if (nome.length > LIMITE_TITULO) e.push(`Mensagem ${n}: o botão "${nome.slice(0, LIMITE_TITULO)}..." passou de ${LIMITE_TITULO} caracteres.`);
          if (b.isLink && !linkValido(b.url)) e.push(`Mensagem ${n}: cole o link do botão ${nome ? `"${nome}"` : j + 1} (começando com https://).`);
        });
        if (p.acao.tipo === "atraso" && p.acao.next === null) e.push(`Mensagem ${n}: escolha qual mensagem enviar depois do atraso.`);
      });
    }
    return e;
  }

  async function salvar() {
    // Palavra digitada sem apertar Enter também conta.
    const pendente = raiz().querySelector("#ed-tag-input");
    if (pendente && pendente.value.trim()) {
      adicionarTags(pendente.value);
      pendente.value = "";
      renderizar();
    }

    const erros = validar();
    const caixa = raiz().querySelector("#ed-erros");
    if (erros.length) {
      caixa.innerHTML = `<div class="alerta alerta-erro"><strong>Falta pouco pra salvar:</strong><ul>${erros.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
      raiz().querySelector(".ed-corpo").scrollTop = 0;
      return;
    }
    caixa.innerHTML = "";

    if (!Dados.MODO_LOCAL && !Dados.temBanco()) {
      toast("O Supabase ainda não foi configurado, então não dá pra salvar. Siga o LEIA-ME.", "erro");
      return;
    }

    const botao = raiz().querySelector("#ed-salvar");
    botao.disabled = true;
    botao.textContent = "Salvando...";
    try {
      const { local } = await Dados.salvarAutomacao(paraAutomacao());
      sujo = false;
      toast(local
        ? "Salvo só neste navegador (modo de teste local). Pra valer de verdade, configure o Supabase pelo LEIA-ME."
        : "Automação salva.", "sucesso");
      const depois = aoSalvar;
      fecharSemPerguntar();
      if (depois) depois();
    } catch (e) {
      toast(e.message, "erro");
      botao.disabled = false;
      botao.textContent = "Salvar";
    }
  }

  // -------------------------------------------------------------------
  // Eventos (um ouvinte de cada tipo pro editor inteiro)
  // -------------------------------------------------------------------
  function aoDigitar(ev) {
    const t = ev.target;
    const d = t.dataset;
    if (d.campo && t.type !== "checkbox" && t.type !== "radio") {
      st[d.campo] = t.value;
      if (d.campo === "botaoTexto") {
        const c = document.getElementById("ed-cont-principal");
        if (c) c.innerHTML = contador(t.value);
        const ref = document.getElementById("ed-ref-botao");
        if (ref) ref.textContent = t.value.trim() || "Texto do botão";
      }
      if (d.campo === "mensagem") {
        const ref = document.getElementById("ed-ref-msg");
        if (ref) ref.textContent = t.value.trim() ? t.value : 'Escreva "Sua mensagem" lá em cima.';
      }
    } else if (d.variante !== undefined) {
      st.variantes[+d.variante] = t.value;
    } else if (d.cp) {
      st.passos[+d.p][d.cp] = t.value;
    } else if (d.cb) {
      st.passos[+d.p].buttons[+d.b][d.cb] = t.value;
      if (d.cb === "title") {
        const c = document.getElementById(`ed-cont-${d.p}-${d.b}`);
        if (c) c.innerHTML = contador(t.value);
      }
    } else if (d.extra === "seconds") {
      st.passos[+d.p].acao.seconds = t.value;
    } else {
      return;
    }
    marcarSujo();
    atualizarPrevia();
  }

  function aoMudar(ev) {
    const t = ev.target;
    const d = t.dataset;

    if (d.campo) {
      if (t.type === "checkbox") {
        st[d.campo] = t.checked;
        marcarSujo();
        if (d.campo === "botaoAtivo" || d.campo === "match_any") renderizar();
        else atualizarPrevia();
        return;
      }
      if (t.type === "radio" && d.campo === "modo") {
        st.modo = t.value;
        if (st.modo === "link") corrigirLinkNoNome(st, "botaoTexto", "link");
        if (st.modo === "conversa" && !st.passos.length) adicionarPasso();
        marcarSujo();
        renderizar();
        return;
      }
      // Colou um link no nome do botão principal estando no modo link? Corrige.
      if (d.campo === "botaoTexto" && st.modo === "link" && corrigirLinkNoNome(st, "botaoTexto", "link")) {
        renderizar();
      }
      return;
    }

    // Destino de um botão da sequência.
    if (d.destino !== undefined) {
      const b = st.passos[+d.p].buttons[+d.b];
      if (t.value === "link") {
        // Guarda a escolha "é link" e mostra o campo NA HORA, mesmo com URL vazia.
        b.isLink = true;
        b.next = null;
        corrigirLinkNoNome(b, "title", "url");
      } else if (t.value === "fim") {
        b.isLink = false;
        b.next = null;
      } else {
        b.isLink = false;
        b.next = Number(t.value.slice(2));
      }
      marcarSujo();
      renderizar();
      return;
    }

    if (d.cb === "title") {
      const b = st.passos[+d.p].buttons[+d.b];
      if (b.isLink && corrigirLinkNoNome(b, "title", "url")) renderizar();
      return;
    }

    if (d.extra === "tipo") {
      const p = st.passos[+d.p];
      p.acao.tipo = t.value;
      if (t.value !== "nenhuma" && p.acao.next === null) p.acao.next = st.passos[+d.p + 1]?.id ?? null;
      marcarSujo();
      renderizar();
      return;
    }

    if (d.extra === "next") {
      st.passos[+d.p].acao.next = t.value === "" ? null : Number(t.value);
      marcarSujo();
      atualizarPrevia();
      return;
    }

    if (d.arquivo !== undefined) {
      const id = d.arquivo;
      st.assets = t.checked ? [...st.assets, id] : st.assets.filter((x) => x !== id);
      marcarSujo();
      atualizarPrevia();
      return;
    }

    if (d.upload !== undefined) {
      enviarArquivo(t.files && t.files[0]);
      t.value = "";
    }
  }

  function aoClicar(ev) {
    const el = ev.target.closest("[data-acao]");
    if (!el) {
      if (ev.target.closest("[data-foco-tags]")) focar("#ed-tag-input");
      return;
    }
    const d = el.dataset;
    switch (d.acao) {
      case "fechar":
        fechar();
        break;
      case "salvar":
        salvar();
        break;
      case "emoji":
        inserirEmoji(d.alvo, d.emoji);
        break;
      case "rm-tag":
        st.keywords.splice(+d.i, 1);
        marcarSujo();
        renderizar();
        focar("#ed-tag-input");
        break;
      case "add-variante":
        st.variantes.push("");
        marcarSujo();
        renderizar();
        focar(`[data-variante="${st.variantes.length - 1}"]`);
        break;
      case "rm-variante":
        st.variantes.splice(+d.i, 1);
        marcarSujo();
        renderizar();
        break;
      case "post": {
        const id = d.id;
        st.media_ids = st.media_ids.includes(id) ? st.media_ids.filter((x) => x !== id) : [...st.media_ids, id];
        marcarSujo();
        document.getElementById("ed-posts").innerHTML = htmlPosts();
        break;
      }
      case "todos-posts":
        ev.preventDefault();
        st.media_ids = [];
        marcarSujo();
        document.getElementById("ed-posts").innerHTML = htmlPosts();
        break;
      case "add-passo": {
        const id = adicionarPasso();
        marcarSujo();
        renderizar();
        focar(`#ed-passo-${id}`);
        break;
      }
      case "rm-passo": {
        const p = st.passos[+d.p];
        if ((p.message.trim() || p.buttons.length) && !confirm(`Remover a Mensagem ${+d.p + 2}?`)) return;
        removerPasso(+d.p);
        marcarSujo();
        renderizar();
        break;
      }
      case "add-botao": {
        const i = +d.p;
        const p = st.passos[i];
        // Por padrão o botão novo vai pra mensagem seguinte (se existir).
        p.buttons.push({ title: "", url: "", next: st.passos[i + 1]?.id ?? null, isLink: false });
        marcarSujo();
        renderizar();
        focar(`[data-p="${i}"][data-b="${p.buttons.length - 1}"][data-cb="title"]`);
        break;
      }
      case "rm-botao":
        st.passos[+d.p].buttons.splice(+d.b, 1);
        marcarSujo();
        renderizar();
        break;
    }
  }

  function aoTeclar(ev) {
    if (ev.key === "Escape") {
      fechar();
      return;
    }
    if (ev.target.id === "ed-tag-input") {
      const campo = ev.target;
      if ((ev.key === "Enter" || ev.key === ",") && campo.value.trim()) {
        ev.preventDefault();
        if (adicionarTags(campo.value)) marcarSujo();
        renderizar();
        focar("#ed-tag-input");
      } else if (ev.key === "Enter") {
        ev.preventDefault();
      } else if (ev.key === "Backspace" && !campo.value && st.keywords.length) {
        st.keywords.pop();
        marcarSujo();
        renderizar();
        focar("#ed-tag-input");
      }
    }
  }

  // Liga os ouvintes uma vez só.
  document.addEventListener("DOMContentLoaded", () => {
    const r = raiz();
    r.addEventListener("input", aoDigitar);
    r.addEventListener("change", aoMudar);
    r.addEventListener("click", aoClicar);
    r.addEventListener("keydown", aoTeclar);
    // Botões de emoji não roubam o foco do campo de texto.
    r.addEventListener("mousedown", (ev) => {
      if (ev.target.closest('[data-acao="emoji"]')) ev.preventDefault();
    });
  });

  // Aviso ao fechar a aba com algo não salvo.
  window.addEventListener("beforeunload", (ev) => {
    if (st && sujo) {
      ev.preventDefault();
      ev.returnValue = "";
    }
  });

  return { abrir, fechar, fecharSemPerguntar, estaAberto };
})();
