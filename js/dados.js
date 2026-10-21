// =====================================================================
// dados.js: camada de dados do painel.
// Decide sozinha entre:
//  * MODO DE TESTE LOCAL (localhost, 127.0.0.1 ou file://): sem Supabase.
//    Login = qualquer e-mail + senha de 5 dígitos. Automações ficam salvas
//    só neste navegador (localStorage), pra dar pra testar o editor.
//  * MODO PRODUÇÃO (no ar): Supabase Auth + banco + Edge Functions.
// Toda chamada é tolerante a falha: se algo der errado, devolve vazio/zero.
// =====================================================================
const Dados = (() => {
  const cfg = window.APP_CONFIG || {};

  const MODO_LOCAL =
    location.protocol === "file:" ||
    ["localhost", "127.0.0.1", "::1", "[::1]", ""].includes(location.hostname);

  const CONFIGURADO =
    !!cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("SEU_PROJETO") &&
    !!cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("SUA_CHAVE");

  let sb = null;
  if (!MODO_LOCAL && CONFIGURADO && window.supabase) {
    try {
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (e) {
      console.warn("Não foi possível iniciar o Supabase:", e);
    }
  }

  const CHAVE_LOGIN = "painel_login_local";
  const CHAVE_AUTOS = "painel_automacoes_local";

  // localStorage pode falhar (aba anônima, bloqueio): sempre com try/catch.
  function lerLocal(chave, padrao) {
    try {
      const v = JSON.parse(localStorage.getItem(chave));
      return v ?? padrao;
    } catch {
      return padrao;
    }
  }
  function gravarLocal(chave, valor) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
      return true;
    } catch {
      return false;
    }
  }
  function gerarId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "local-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // -------------------------------------------------------------------
  // LOGIN
  // -------------------------------------------------------------------
  async function sessaoAtual() {
    if (MODO_LOCAL) return lerLocal(CHAVE_LOGIN, null);
    if (!sb) return null;
    try {
      const { data } = await sb.auth.getSession();
      return data.session ? { email: data.session.user.email } : null;
    } catch {
      return null;
    }
  }

  async function entrar(email, senha) {
    email = (email || "").trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Digite um e-mail válido.");

    if (MODO_LOCAL) {
      if (!/^\d{5}$/.test(senha)) {
        throw new Error("No modo de teste local, a senha precisa ter exatamente 5 dígitos (só números).");
      }
      const sessao = { email };
      gravarLocal(CHAVE_LOGIN, sessao);
      return sessao;
    }

    if (!sb) {
      throw new Error("O login ainda não foi configurado. Preencha o arquivo js/config.js com os dados do Supabase (veja o LEIA-ME).");
    }
    let resposta;
    try {
      resposta = await sb.auth.signInWithPassword({ email, password: senha });
    } catch {
      throw new Error("Não foi possível conectar. Verifique sua internet e tente de novo.");
    }
    if (resposta.error) {
      if (/fetch|network/i.test(resposta.error.message || "")) {
        throw new Error("Não foi possível conectar. Verifique sua internet e tente de novo.");
      }
      throw new Error("E-mail ou senha incorretos.");
    }
    return { email: resposta.data.user.email };
  }

  async function sair() {
    if (MODO_LOCAL) {
      try { localStorage.removeItem(CHAVE_LOGIN); } catch { /* nada */ }
      return;
    }
    try { await sb?.auth.signOut(); } catch { /* nada */ }
  }

  // Chama "callback" quando a sessão do Supabase expira ou some.
  function aoPerderSessao(callback) {
    if (!sb) return;
    sb.auth.onAuthStateChange((_evento, sessao) => {
      if (!sessao) callback();
    });
  }

  // -------------------------------------------------------------------
  // AUTOMAÇÕES
  // -------------------------------------------------------------------
  async function listarAutomacoes() {
    if (MODO_LOCAL) return lerLocal(CHAVE_AUTOS, []);
    if (!sb) return [];
    try {
      const { data, error } = await sb.from("ig_automations").select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn("Falha ao listar automações:", e);
      return [];
    }
  }

  // Retorna { registro, local } ou lança um erro com mensagem amigável.
  async function salvarAutomacao(automacao) {
    const registro = { ...automacao, updated_at: new Date().toISOString() };

    if (MODO_LOCAL) {
      const lista = lerLocal(CHAVE_AUTOS, []);
      if (!registro.id) registro.id = gerarId();
      const i = lista.findIndex((a) => a.id === registro.id);
      if (i >= 0) lista[i] = registro; else lista.unshift(registro);
      if (!gravarLocal(CHAVE_AUTOS, lista)) throw new Error("O navegador não deixou salvar (armazenamento bloqueado).");
      return { registro, local: true };
    }

    if (!sb) throw new Error("O Supabase ainda não foi configurado, então não dá pra salvar. Siga o LEIA-ME.");
    const corpo = { ...registro };
    if (!corpo.id) delete corpo.id;
    const { data, error } = await sb.from("ig_automations").upsert(corpo).select().single();
    if (error) throw new Error("Não foi possível salvar. Tente de novo em instantes.");
    return { registro: data, local: false };
  }

  async function excluirAutomacao(id) {
    if (MODO_LOCAL) {
      gravarLocal(CHAVE_AUTOS, lerLocal(CHAVE_AUTOS, []).filter((a) => a.id !== id));
      return;
    }
    if (!sb) throw new Error("Supabase não configurado.");
    const { error } = await sb.from("ig_automations").delete().eq("id", id);
    if (error) throw new Error("Não foi possível apagar.");
  }

  async function definirAtiva(id, ativa) {
    if (MODO_LOCAL) {
      const lista = lerLocal(CHAVE_AUTOS, []);
      const a = lista.find((x) => x.id === id);
      if (a) a.active = ativa;
      gravarLocal(CHAVE_AUTOS, lista);
      return;
    }
    if (!sb) throw new Error("Supabase não configurado.");
    const { error } = await sb.from("ig_automations").update({ active: ativa }).eq("id", id);
    if (error) throw new Error("Não foi possível atualizar.");
  }

  // -------------------------------------------------------------------
  // NÚMEROS DO PAINEL
  // -------------------------------------------------------------------
  async function contar(tabela, filtro) {
    if (!sb) return 0;
    try {
      let q = sb.from(tabela).select("*", { count: "exact", head: true });
      if (filtro) q = filtro(q);
      const { count, error } = await q;
      if (error) throw error;
      return count || 0;
    } catch {
      return 0;
    }
  }

  async function resumo() {
    if (MODO_LOCAL) {
      const autos = lerLocal(CHAVE_AUTOS, []);
      return { leads: 0, ativas: autos.filter((a) => a.active).length, dms7: 0 };
    }
    const seteDias = new Date(Date.now() - 7 * 86400000).toISOString();
    const [leads, ativas, dms7] = await Promise.all([
      contar("ig_leads"),
      contar("ig_automations", (q) => q.eq("active", true)),
      contar("ig_deliveries", (q) => q.eq("status", "ok").gte("ts", seteDias)),
    ]);
    return { leads, ativas, dms7 };
  }

  // -------------------------------------------------------------------
  // EDGE FUNCTIONS (ig-insights, ig-media)
  // -------------------------------------------------------------------
  async function chamarFuncao(nome) {
    if (!sb) return null;
    try {
      const { data, error } = await sb.functions.invoke(nome);
      if (error) throw error;
      return data;
    } catch (e) {
      console.warn(`Função ${nome} indisponível:`, e);
      return null;
    }
  }

  // -------------------------------------------------------------------
  // ARQUIVOS (biblioteca)
  // -------------------------------------------------------------------
  async function listarArquivos() {
    if (!sb) return [];
    try {
      const { data, error } = await sb.from("ig_assets").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    } catch {
      return [];
    }
  }

  function tipoDoArquivo(mime) {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
    return "file";
  }

  async function enviarArquivo(arquivo) {
    if (!sb) throw new Error("Configure o Supabase pra enviar arquivos.");
    const nomeSeguro = arquivo.name.normalize("NFD").replace(/[^\w.-]+/g, "_");
    const caminho = `${Date.now()}-${nomeSeguro}`;
    const up = await sb.storage.from("ig-assets").upload(caminho, arquivo, { contentType: arquivo.type });
    if (up.error) throw new Error("Não foi possível enviar o arquivo.");
    const { data: pub } = sb.storage.from("ig-assets").getPublicUrl(caminho);
    const { data, error } = await sb.from("ig_assets").insert({
      nome: arquivo.name,
      tipo: tipoDoArquivo(arquivo.type || ""),
      public_url: pub.publicUrl,
      size_bytes: arquivo.size,
    }).select().single();
    if (error) throw new Error("Arquivo enviado, mas não foi registrado na biblioteca.");
    return data;
  }

  return {
    MODO_LOCAL,
    CONFIGURADO,
    temBanco: () => !!sb,
    sessaoAtual,
    entrar,
    sair,
    aoPerderSessao,
    listarAutomacoes,
    salvarAutomacao,
    excluirAutomacao,
    definirAtiva,
    resumo,
    contarLeads: () => (MODO_LOCAL ? Promise.resolve(0) : contar("ig_leads")),
    chamarFuncao,
    listarArquivos,
    enviarArquivo,
  };
})();
