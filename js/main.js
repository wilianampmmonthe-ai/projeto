function $(id) {
  return document.getElementById(id);
}

function setLoggedIn(isLoggedIn) {
  const login = $("loginScreen");
  const app = $("app");
  if (login) login.style.display = isLoggedIn ? "none" : "flex";
  if (app) app.style.display = isLoggedIn ? "block" : "none";
}

function safeToast(msg, type) {
  const fixedMsg = normalizeUiText(msg);
  if (typeof window.toast === "function") {
    window.toast(fixedMsg, type || "info");
  } else {
    console.log(`[${type || "info"}]`, fixedMsg);
  }
}

function normalizeUiText(msg) {
  let text = String(msg || "");
  if (!/[ÃÂ]/.test(text)) return text;

  const replacements = [
    ["Ã¡", "á"], ["Ã ", "à"], ["Ã¢", "â"], ["Ã£", "ã"], ["Ã¤", "ä"],
    ["Ã©", "é"], ["Ã¨", "è"], ["Ãª", "ê"], ["Ã«", "ë"],
    ["Ã­", "í"], ["Ã¬", "ì"], ["Ã®", "î"], ["Ã¯", "ï"],
    ["Ã³", "ó"], ["Ã²", "ò"], ["Ã´", "ô"], ["Ãµ", "õ"], ["Ã¶", "ö"],
    ["Ãº", "ú"], ["Ã¹", "ù"], ["Ã»", "û"], ["Ã¼", "ü"],
    ["Ã", "Á"], ["Ã€", "À"], ["Ã‚", "Â"], ["Ãƒ", "Ã"], ["Ã„", "Ä"],
    ["Ã‰", "É"], ["Ãˆ", "È"], ["ÃŠ", "Ê"], ["Ã‹", "Ë"],
    ["Ã", "Í"], ["ÃŒ", "Ì"], ["ÃŽ", "Î"], ["Ã", "Ï"],
    ["Ã“", "Ó"], ["Ã’", "Ò"], ["Ã”", "Ô"], ["Ã•", "Õ"], ["Ã–", "Ö"],
    ["Ãš", "Ú"], ["Ã™", "Ù"], ["Ã›", "Û"], ["Ãœ", "Ü"],
    ["Ã§", "ç"], ["Ã‡", "Ç"], ["Ã±", "ñ"], ["Ã‘", "Ñ"],
    [" Â· ", " • "], ["Â·", "•"], ["Â •", " •"], ["•Â", "•"],
    [" Â ", " "], ["Âº", "º"], ["Âª", "ª"], ["Â", ""]
  ];

  replacements.forEach(([from, to]) => {
    text = text.split(from).join(to);
  });

  return text;
}

const fb = {
  get auth() {
    if (!window.firebase || !firebase.apps?.length) {
      throw new Error("Firebase nÃ£o inicializado.");
    }
    return firebase.auth();
  },
  get db() {
    if (!window.firebase || !firebase.apps?.length) {
      throw new Error("Firebase nÃ£o inicializado.");
    }
    return firebase.firestore();
  },
  get storage() {
    if (!window.firebase || !firebase.apps?.length) {
      throw new Error("Firebase nÃ£o inicializado.");
    }
    return firebase.storage();
  }
};

// --- LOGIN ---
window.doLogin = async function doLogin() {
  try {
    const email = document.getElementById("loginUser")?.value?.trim();
    const pass = document.getElementById("loginPass")?.value;

    if (!email || !pass) {
      safeToast("Preencha e-mail e senha.", "error");
      return;
    }

    await loginWithEmail(email, pass);
  } catch (e) {
    console.error("ERRO LOGIN:", e);

    let msg = "Falha no login";
    if (
      e.code === "auth/user-not-found" ||
      e.code === "auth/wrong-password" ||
      e.code === "auth/invalid-credential"
    ) {
      msg = "E-mail ou senha incorretos.";
    } else if (e.code === "auth/invalid-email") {
      msg = "E-mail invÃ¡lido.";
    } else if (e?.message) {
      msg = e.message;
    }

    safeToast(msg, "error");
  }
};
globalThis.doLogin = window.doLogin;

window.doLogout = async function doLogout() {
  try {
    await logout();
    safeToast("SessÃ£o encerrada.", "success");
  } catch (e) {
    console.error("ERRO LOGOUT:", e);
  }
};

globalThis.doLogout = window.doLogout;

// --- REALTIME ---
let unsubFuncionarios = null;
let unsubEmpresas = null;
let unsubObra = null;
let unsubFreq = null;
let unsubUsuarios = null;

function stopRealtime() {
  if (typeof unsubFuncionarios === "function") unsubFuncionarios();
  if (typeof unsubEmpresas === "function") unsubEmpresas();
  if (typeof unsubObra === "function") unsubObra();
  if (typeof unsubFreq === "function") unsubFreq();
  if (typeof unsubUsuarios === "function") unsubUsuarios();

  unsubFuncionarios = null;
  unsubEmpresas = null;
  unsubObra = null;
  unsubFreq = null;
  unsubUsuarios = null;
}

function ensureDB() {
  const db = window.DB || (window.DB = {});
  if (!Array.isArray(db.funcionarios)) db.funcionarios = [];
  if (!Array.isArray(db.empresas)) db.empresas = [];
  if (!Object.prototype.hasOwnProperty.call(db, "obra")) db.obra = null;
  if (!Object.prototype.hasOwnProperty.call(db, "currentEditId")) db.currentEditId = null;
  if (!db.tempDocs || typeof db.tempDocs !== "object" || Array.isArray(db.tempDocs)) db.tempDocs = {};
  if (!db.tempEmpresaDocs || typeof db.tempEmpresaDocs !== "object" || Array.isArray(db.tempEmpresaDocs)) {
    db.tempEmpresaDocs = {};
  }
  return db;
}

function ensureFreqState() {
  const state = window.freqState || (window.freqState = {});
  if (!Object.prototype.hasOwnProperty.call(state, "periodoKey")) state.periodoKey = "";
  if (!state.data || typeof state.data !== "object" || Array.isArray(state.data)) state.data = {};
  if (!Object.prototype.hasOwnProperty.call(state, "ctxTarget")) state.ctxTarget = null;
  if (!Array.isArray(state.feriadoDates)) state.feriadoDates = [];
  if (!state.feriadoDateObs || typeof state.feriadoDateObs !== "object" || Array.isArray(state.feriadoDateObs)) {
    state.feriadoDateObs = {};
  }
  return state;
}

function ensureCurrentUserProfile() {
  const profile = window.currentUserProfile || (window.currentUserProfile = {});
  if (!profile.role) profile.role = "viewer";
  if (!profile.status) profile.status = "active";
  if (!profile.email) profile.email = "";
  if (!profile.id) profile.id = "";
  return profile;
}

function getUserRole() {
  return String(window.currentUserProfile?.role || "viewer");
}

window.isAdmin = function isAdmin() {
  return getUserRole() === "admin";
};

window.isEditor = function isEditor() {
  return getUserRole() === "editor";
};

window.isViewer = function isViewer() {
  return getUserRole() === "viewer";
};

window.canManageUsers = function canManageUsers() {
  return window.isAdmin();
};

window.canEditObra = function canEditObra() {
  return window.isAdmin();
};

window.canEditFuncionarios = function canEditFuncionarios() {
  return window.isAdmin() || window.isEditor();
};

window.canEditEmpresas = function canEditEmpresas() {
  return window.isAdmin() || window.isEditor();
};

window.canEditFrequencia = function canEditFrequencia() {
  return window.isAdmin() || window.isEditor();
};

window.canExportDocumentos = function canExportDocumentos() {
  return window.isAdmin() || window.isEditor();
};

window.nlGetSessao = function nlGetSessao() {
  const user = fb.auth.currentUser;
  const profile = ensureCurrentUserProfile();
  return user ? {
    uid: String(user.uid),
    email: profile.email || user.email || "",
    tipoUsuario: profile.role || "viewer",
    status: profile.status || "active",
  } : null;
};

function requirePermission(check, message) {
  if (typeof check === "function" && check()) return true;
  safeToast(message || "VocÃª nÃ£o tem permissÃ£o para esta aÃ§Ã£o.", "error");
  return false;
}

function setElementVisible(selector, visible) {
  document.querySelectorAll(selector).forEach((el) => {
    el.style.display = visible ? "" : "none";
  });
}

function setElementsDisabled(selector, disabled) {
  document.querySelectorAll(selector).forEach((el) => {
    if ("disabled" in el) {
      el.disabled = disabled;
    }
    el.style.pointerEvents = disabled ? "none" : "";
    el.style.opacity = disabled ? "0.55" : "";
  });
}

function updateUserIdentityUI() {
  const user = fb.auth.currentUser;
  const profile = ensureCurrentUserProfile();
  const email = profile.email || user?.email || "UsuÃ¡rio";
  const roleLabels = { admin: "Administrador", editor: "Editor", viewer: "Visualizador" };
  const statusLabels = { active: "Ativo", blocked: "Bloqueado", suspended: "Suspenso" };
  const initials = email
    .split("@")[0]
    .split(/[.\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || "")
    .join("") || "US";

  const avatar = document.querySelector(".user-avatar");
  if (avatar) avatar.textContent = initials;

  const nameEl = document.querySelector(".u-name");
  if (nameEl) nameEl.textContent = email;

  const roleEl = document.querySelector(".u-role");
  if (roleEl) {
    const role = roleLabels[profile.role] || "Visualizador";
    const status = statusLabels[profile.status] || "Ativo";
    roleEl.textContent = normalizeUiText(`${role} • ${status}`);
  }
}

function updatePermissionUI() {
  const canAdmin = window.canManageUsers();
  const canObra = window.canEditObra();
  const canFuncionarios = window.canEditFuncionarios();
  const canEmpresas = window.canEditEmpresas();
  const canFreq = window.canEditFrequencia();
  const canExport = window.canExportDocumentos();

  setElementVisible("#nav-admin-section", canAdmin);
  setElementVisible("#nav-obra-item", canObra);
  setElementVisible("#adminBackupSection", canAdmin);

  setElementVisible("#btnNovoFuncionarioDashboard", canFuncionarios);
  setElementVisible("#btnNovoTerceirizado", canFuncionarios);
  setElementVisible("#btnNovoAtacarejo", canFuncionarios);
  setElementVisible("#btnNovaEmpresa", canEmpresas);
  setElementVisible("#btnSalvarObraModal", canObra);

  setElementsDisabled("#page-frequencia .ctx-item", !canFreq);
  setElementsDisabled("#btnFreqFeriadosMes", !canFreq);
  setElementsDisabled("#btnFreqFeriadoTodos", !canFreq);
  setElementsDisabled("#btnFreqFolgaTodos", !canFreq);
  setElementsDisabled("#btnFreqExportExcel", !canExport);
  setElementsDisabled("#btnFreqExportPDF", !canExport);
  setElementsDisabled("#btnAtaTercExcel", !canExport);
  setElementsDisabled("#btnAtaTercPDF", !canExport);
  setElementsDisabled("#btnAtaAtacExcel", !canExport);
  setElementsDisabled("#btnAtaAtacPDF", !canExport);

  const activePage = document.querySelector(".page.active")?.id;
  if (activePage === "page-admin" && !canAdmin) {
    const dashboardNav = document.querySelector("[data-page='dashboard']");
    if (dashboardNav) {
      window.showPage("dashboard", dashboardNav);
    }
  }

  updateUserIdentityUI();
}

function normalizeUserProfile(profile, fallbackUser) {
  const email = String(profile?.email || fallbackUser?.email || "").trim().toLowerCase();
  return {
    id: String(profile?.id || fallbackUser?.uid || ""),
    email,
    role: String(profile?.role || "viewer"),
    status: String(profile?.status || "active"),
    createdAt: profile?.createdAt || null,
    updatedAt: profile?.updatedAt || null,
  };
}

async function loadCurrentUserProfile(user) {
  const profile = await ensureUsuarioProfile(user);
  const normalized = normalizeUserProfile(profile, user);
  window.currentUserProfile = normalized;
  updatePermissionUI();
  return normalized;
}

function renderAdminUsers() {
  const tbody = document.getElementById("adminUsersTableBody");
  if (!tbody) return;

  if (!window.canManageUsers()) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><p>Acesso restrito aos administradores.</p></td></tr>';
    return;
  }

  const users = Array.isArray(window.appUsers) ? window.appUsers : [];
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><p>Nenhum usuÃ¡rio encontrado.</p></td></tr>';
    return;
  }

  tbody.innerHTML = users.map((user) => {
    const role = String(user.role || "viewer");
    const status = String(user.status || "active");
    return `<tr>
      <td>${user.email || ""}</td>
      <td>${user.id || ""}</td>
      <td>
        <select class="admin-inline-select" id="admin-role-${user.id}">
          <option value="admin" ${role === "admin" ? "selected" : ""}>admin</option>
          <option value="editor" ${role === "editor" ? "selected" : ""}>editor</option>
          <option value="viewer" ${role === "viewer" ? "selected" : ""}>viewer</option>
        </select>
      </td>
      <td>
        <select class="admin-inline-select" id="admin-status-${user.id}">
          <option value="active" ${status === "active" ? "selected" : ""}>active</option>
          <option value="blocked" ${status === "blocked" ? "selected" : ""}>blocked</option>
          <option value="suspended" ${status === "suspended" ? "selected" : ""}>suspended</option>
        </select>
      </td>
      <td><button class="btn btn-primary btn-sm" onclick='saveAdminUser(${JSON.stringify(user.id)})'>Salvar</button></td>
    </tr>`;
  }).join("");
}

window.saveAdminUser = async function saveAdminUser(uid) {
  if (!requirePermission(window.canManageUsers, "Apenas administradores podem alterar usuÃ¡rios.")) return;

  try {
    const existing = (window.appUsers || []).find((user) => String(user.id) === String(uid));
    if (!existing) {
      safeToast("UsuÃ¡rio nÃ£o encontrado.", "error");
      return;
    }

    const role = document.getElementById(`admin-role-${uid}`)?.value || existing.role || "viewer";
    const status = document.getElementById(`admin-status-${uid}`)?.value || existing.status || "active";

    console.log("[ui] salvar usuario", { uid: String(uid), role, status });
    await salvarUsuario(uid, { email: existing.email, role, status });
    safeToast("UsuÃ¡rio atualizado com sucesso.", "success");
  } catch (e) {
    console.error("ERRO AO SALVAR USUÃRIO:", e);
    safeToast(e?.message || "Erro ao salvar usuÃ¡rio", "error");
  }
};

function cloneData(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback));
  } catch (e) {
    return fallback;
  }
}

function collectFuncionarioDocs(tipo) {
  if (typeof window.collectDocs === "function") {
    const docs = window.collectDocs(tipo);
    if (docs && typeof docs === "object" && !Array.isArray(docs)) {
      return cloneData(docs, {});
    }
  }

  const db = ensureDB();
  return cloneData(db.tempDocs || {}, {});
}

function collectEmpresaDocs() {
  const db = ensureDB();
  const docs = {};

  ["pgr", "pcmso", "art"].forEach((key) => {
    const status = $(`e-${key}`)?.value || "Pendente";
    const fileData = db.tempEmpresaDocs[key] || null;

    docs[key] = {
      status,
      fileName: fileData?.name || null,
      dataURL: fileData?.dataURL || null,
    };
  });

  return cloneData(docs, {});
}

function createEmptyFreqPeriod() {
  return { feriados: {}, terceirizados: {}, novoAtacarejo: {} };
}

async function persistFreqStateSnapshot(periodoKey) {
  const state = ensureFreqState();

  try {
    localStorage.setItem("frequencia", JSON.stringify(state.data));
  } catch (e) {
    console.error("Erro ao persistir frequencia localmente:", e);
  }

  if (!fb.auth.currentUser || typeof window.freqGetPeriodoKey !== "function") return;

  const pk = periodoKey || window.freqGetPeriodoKey();
  if (!pk) return;

  try {
    const periodData = cloneData(state.data?.[pk] || createEmptyFreqPeriod(), createEmptyFreqPeriod());
    await salvarFrequencia(pk, periodData);
  } catch (e) {
    console.error("Erro ao sincronizar frequencia:", e);
  }
}

function buildPrunedFreqPeriods(funcId) {
  const state = ensureFreqState();
  const targetId = String(funcId);
  const changedPeriods = {};

  if (state.ctxTarget && String(state.ctxTarget.funcId) === targetId) {
    state.ctxTarget = null;
  }

  Object.entries(state.data || {}).forEach(([pk, periodo]) => {
    if (!periodo || typeof periodo !== "object") return;

    const nextPeriodo = cloneData(periodo, createEmptyFreqPeriod());
    let changed = false;

    ["terceirizados", "novoAtacarejo"].forEach((tipo) => {
      const bucket = nextPeriodo[tipo];
      if (!bucket || typeof bucket !== "object") return;

      if (Object.prototype.hasOwnProperty.call(bucket, targetId)) {
        delete bucket[targetId];
        changed = true;
      }
    });

    if (changed) {
      changedPeriods[pk] = nextPeriodo;
    }
  });

  return changedPeriods;
}

async function pruneFuncionarioReferences(funcId) {
  const changedPeriods = buildPrunedFreqPeriods(funcId);
  const periodoKeys = Object.keys(changedPeriods);

  if (!periodoKeys.length) return false;

  for (const pk of periodoKeys) {
    await salvarFrequencia(pk, changedPeriods[pk]);
  }

  return true;
}

window.syncRemoteFreqState = persistFreqStateSnapshot;

function syncFrequenciaListener() {
  if (typeof unsubFreq === "function") {
    unsubFreq();
    unsubFreq = null;
  }

  if (typeof window.freqGetPeriodoKey !== "function") return;

  const pk = window.freqGetPeriodoKey();
  if (!pk) return;

  unsubFreq = ouvirFrequencia(pk, (payload) => {
    const freqState = ensureFreqState();
    freqState.data[pk] = cloneData(payload?.data || createEmptyFreqPeriod(), createEmptyFreqPeriod());
    try {
      localStorage.setItem("frequencia", JSON.stringify(freqState.data));
    } catch (e) {
      console.error("Erro ao atualizar cache local da frequencia:", e);
    }
    if (typeof window.freqRender === "function") window.freqRender();
  });
}

window.syncFrequenciaListener = syncFrequenciaListener;

function wireRealtimeForUser() {
  ensureDB();
  window.appUsers = window.appUsers || [];

  unsubFuncionarios = listenFuncionarios((rows) => {
    window.DB.funcionarios = rows;
    if (typeof window.refreshAll === "function") window.refreshAll();
  });

  unsubEmpresas = listenEmpresas((rows) => {
    window.DB.empresas = rows;
    if (typeof window.refreshAll === "function") window.refreshAll();
  });

  unsubObra = listenObra((obra) => {
    window.DB.obra = obra;
    if (typeof window.updateObraInterface === "function") window.updateObraInterface();
    if (typeof window.refreshAll === "function") window.refreshAll();
  });

  if (window.canManageUsers()) {
    unsubUsuarios = ouvirUsuarios((rows) => {
      window.appUsers = rows.map((row) => normalizeUserProfile(row));
      renderAdminUsers();
    });
  }

  syncFrequenciaListener();
  updatePermissionUI();
}

// --- SESSÃƒO ---
watchSession(async (user) => {
  if (!user) {
    stopRealtime();
    window.currentUserProfile = null;
    window.appUsers = [];
    setLoggedIn(false);
    updatePermissionUI();
    return;
  }

  try {
    const profile = await loadCurrentUserProfile(user);

    if (profile.status === "blocked") {
      alert("Acesso bloqueado");
      await logout();
      return;
    }

    if (profile.status === "suspended") {
      alert("Acesso suspenso");
      await logout();
      return;
    }

    setLoggedIn(true);
    wireRealtimeForUser();
    renderAdminUsers();
    safeToast("SessÃ£o autenticada.", "success");
  } catch (e) {
    console.error("ERRO AO CARREGAR PERFIL:", e);
    safeToast(e?.message || "Erro ao carregar permissÃµes do usuÃ¡rio.", "error");
    await logout();
  }
});
/*
  safeToast("SessÃ£o autenticada.", "success");
});

// --- FREQUÃŠNCIA ---
  } catch (e) {
    console.error("ERRO AO CARREGAR PERFIL:", e);
    safeToast(e?.message || "Erro ao carregar permissÃµes do usuÃ¡rio.", "error");
    await logout();
  }
});

*/
window.freqSaveData = function () {
  if (!requirePermission(window.canEditFrequencia, "Seu perfil nÃ£o pode editar a frequÃªncia.")) return;
  if (!fb.auth.currentUser) return;
  if (!window.freqState || typeof window.freqGetPeriodoKey !== "function") return;

  const pk = window.freqGetPeriodoKey();
  if (!pk) return;

  const data = window.freqState.data?.[pk] || createEmptyFreqPeriod();

  console.log("[ui] salvar frequencia", { periodoKey: pk });
  salvarFrequencia(pk, data).catch((e) => {
    console.error("ERRO AO SALVAR FREQUÃŠNCIA:", e);
    safeToast(e?.message || "Erro ao salvar frequÃªncia", "error");
  });
};

// --- FUNCIONÃRIO: SALVAR ---
window.saveFuncionario = async function () {
  try {
    const db = ensureDB();
    if (!requirePermission(window.canEditFuncionarios, "Seu perfil nÃ£o pode salvar funcionÃ¡rios.")) return;
    if (!fb.auth.currentUser) {
      safeToast("VocÃª precisa estar autenticado.", "error");
      return;
    }

    const nome = $("f-nome")?.value?.trim();
    const cpf = $("f-cpf")?.value?.trim();
    const tipoRaw = $("f-tipo")?.value || "";
    
    let tipo = "";
    if (tipoRaw === "Terceirizado" || tipoRaw === "terceirizado") {
      tipo = "Terceirizado";
    } else if (
      tipoRaw === "Novo Atacarejo" ||
      tipoRaw === "novo-atacarejo" ||
      tipoRaw === "atacarejo" ||
      tipoRaw === "NovoAtacarejo"
    ) {
      tipo = "Novo Atacarejo";
    }

    const empresa = $("f-empresa")?.value?.trim() || "";
    const funcao = $("f-funcao")?.value?.trim() || "";
    const admissao = $("f-admissao")?.value || "";
    const tel = $("f-tel")?.value || "";
    const email = $("f-email")?.value || "";

    if (!nome || !cpf || !tipo || !empresa || !funcao) {
      safeToast("Preencha todos os campos obrigatÃ³rios.", "error");
      return;
    }

    const funcionarioId = db.currentEditId || crypto.randomUUID();
    const docs = collectFuncionarioDocs(tipo);
    const row = { 
      nome, cpf, tipo, empresa, funcao, admissao, tel, email,
      docs
    };

    console.log("[ui] salvar funcionario", { id: funcionarioId, tipo });
    await salvarFuncionario({ ...row, id: funcionarioId });

    db.currentEditId = null;
    db.tempDocs = {};

    if (typeof window.closeModal === "function") {
      window.closeModal("modalCadastro");
    }

    safeToast("FuncionÃ¡rio salvo!", "success");
  } catch (e) {
    console.error("ERRO AO SALVAR FUNCIONÃRIO:", e);
    safeToast(e?.message || "Erro ao salvar funcionÃ¡rio", "error");
  }
};

// --- FUNCIONÃRIO: EDITAR ---
window.editFuncionario = function(id) {
  const db = ensureDB();
  const func = db.funcionarios.find(f => String(f.id) === String(id));
  if (!func) return;
  
  db.currentEditId = id;
  db.tempDocs = {};
  
  document.getElementById('modalCadastroTitle').textContent = 'Editar FuncionÃ¡rio';
  document.getElementById('f-nome').value = func.nome || '';
  document.getElementById('f-cpf').value = func.cpf || '';
  document.getElementById('f-tipo').value = func.tipo || '';
  document.getElementById('f-empresa').value = func.empresa || '';
  document.getElementById('f-funcao').value = func.funcao || '';
  document.getElementById('f-admissao').value = func.admissao || '';
  document.getElementById('f-tel').value = func.tel || '';
  document.getElementById('f-email').value = func.email || '';
  
  if (typeof window.buildDocFields === 'function') {
    document.getElementById('docsFields').innerHTML = window.buildDocFields(func.tipo, func.docs || {});
    document.getElementById('trainFields').innerHTML = window.buildTrainFields(func.tipo, func.docs || {});
  }
  
  if (typeof window.updateEmpresasSuggestions === 'function') {
    window.updateEmpresasSuggestions();
  }
  
  if (typeof window.showTab === 'function') {
    window.showTab('tab-dados', document.querySelector('#modalCadastro .tab-btn'));
  }
  
  if (typeof window.openModal === 'function') {
    window.openModal('modalCadastro');
  }
};

// --- FUNCIONÃRIO: REMOVER (APENAS UMA VERSÃƒO) ---
window.removeFuncionario = async function removeFuncionario(id) {
  try {
    const db = ensureDB();
    if (!requirePermission(window.canEditFuncionarios, "Seu perfil nÃ£o pode remover funcionÃ¡rios.")) return;
    if (!fb.auth.currentUser) {
      safeToast("VocÃª precisa estar autenticado.", "error");
      return;
    }

    if (!confirm("Remover este funcionÃ¡rio permanentemente?")) return;

    console.log("[ui] remover funcionario", { id: String(id) });
    await removerFuncionario(id);

    if (String(db.currentEditId) === String(id)) {
      db.currentEditId = null;
      db.tempDocs = {};
    }

    await pruneFuncionarioReferences(id);

    safeToast("FuncionÃ¡rio removido com sucesso.", "success");
  } catch (e) {
    console.error("ERRO AO REMOVER FUNCIONÃRIO:", e);
    safeToast(e?.message || "Erro ao remover funcionÃ¡rio", "error");
  }
};

// --- EMPRESA: SALVAR ---
window.saveEmpresa = async function () {
  try {
    const db = ensureDB();
    if (!requirePermission(window.canEditEmpresas, "Seu perfil nÃ£o pode salvar empresas.")) return;

    if (!fb.auth.currentUser) {
      safeToast("VocÃª precisa estar autenticado.", "error");
      return;
    }

    const nome = $("e-nome")?.value?.trim();
    const cnpjRaw = $("e-cnpj")?.value?.trim() || "";
    const cnpjDigits = cnpjRaw.replace(/\D/g, "");
    const cnpj = cnpjDigits
      .replace(/^(\d{2})(\d)/, "$1.$2")
      .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1/$2")
      .replace(/(\d{4})(\d)/, "$1-$2");
    const resp = $("e-resp")?.value?.trim() || "";

    if (!nome || !cnpjDigits) {
      safeToast("Informe o nome e o CNPJ da empresa.", "error");
      return;
    }

    if (cnpjDigits.length !== 14) {
      safeToast("O CNPJ deve conter 14 dÃ­gitos.", "error");
      return;
    }

    const empresaId = crypto.randomUUID();
    const row = { nome, cnpj, resp, docs: collectEmpresaDocs() };

    console.log("[ui] salvar empresa", { id: empresaId, nome });
    await salvarEmpresa({ ...row, id: empresaId });

    db.tempEmpresaDocs = {};

    if (typeof window.closeModal === "function") {
      window.closeModal("modalEmpresa");
    }

    safeToast("Empresa salva com sucesso.", "success");
  } catch (e) {
    console.error("ERRO AO SALVAR EMPRESA:", e);
    safeToast(e?.message || "Erro ao salvar empresa", "error");
  }
};

// --- EMPRESA: REMOVER ---
window.removeEmpresa = async function removeEmpresa(id) {
  try {
    if (!requirePermission(window.canEditEmpresas, "Seu perfil nÃ£o pode remover empresas.")) return;
    if (!fb.auth.currentUser) {
      safeToast("VocÃª precisa estar autenticado.", "error");
      return;
    }

    if (!confirm("Remover esta empresa? Os funcionÃ¡rios vinculados nÃ£o serÃ£o afetados.")) return;

    console.log("[ui] remover empresa", { id: String(id) });
    await removerEmpresa(id);

    safeToast("Empresa removida com sucesso.", "success");
  } catch (e) {
    console.error("ERRO AO REMOVER EMPRESA:", e);
    safeToast(e?.message || "Erro ao remover empresa", "error");
  }
};

// --- OBRA: SALVAR ---
window.saveObra = async function () {
  try {
    if (!requirePermission(window.canEditObra, "Apenas administradores podem editar a obra.")) return;
    if (!fb.auth.currentUser) {
      safeToast("VocÃª precisa estar autenticado.", "error");
      return;
    }

    // Coletar dados do formulÃ¡rio
    const cnpj = $("o-cnpj")?.value?.trim() || "";
    const nome = $("o-nome")?.value?.trim() || "";
    const logradouro = $("o-logradouro")?.value?.trim() || "";
    const numero = $("o-numero")?.value?.trim() || "";
    const cep = $("o-cep")?.value?.trim() || "";
    const bairro = $("o-bairro")?.value?.trim() || "";
    const municipio = $("o-municipio")?.value?.trim() || "";
    const uf = $("o-uf")?.value || "PE";

    if (!cnpj || !nome || !logradouro || !numero || !cep || !bairro || !municipio || !uf) {
      safeToast("Preencha todos os campos obrigatÃ³rios da empresa.", "error");
      return;
    }

    // Coletar equipe de engenharia
    const equipeEng = [];
    document.querySelectorAll('.eng-member').forEach(el => {
      const engNome = el.querySelector('.eng-nome')?.value?.trim();
      const funcao = el.querySelector('.eng-funcao')?.value;
      const crea = el.querySelector('.eng-crea')?.value?.trim();
      const telefone = el.querySelector('.eng-telefone')?.value?.trim();
      const empresa = el.querySelector('.eng-empresa')?.value?.trim();
      
      if (engNome || funcao || crea || telefone || empresa) {
        equipeEng.push({ nome: engNome, funcao, crea, telefone, empresa });
      }
    });

    // Coletar equipe de SST
    const equipeSST = [];
    document.querySelectorAll('.sst-member').forEach(el => {
      const sstNome = el.querySelector('.sst-nome')?.value?.trim();
      const funcao = el.querySelector('.sst-funcao')?.value;
      const telefone = el.querySelector('.sst-telefone')?.value?.trim();
      const departamento = el.querySelector('.sst-depto')?.value;
      const mte = el.querySelector('.sst-mte')?.value?.trim();
      
      if (sstNome || funcao || telefone || departamento || mte) {
        equipeSST.push({ nome: sstNome, funcao, telefone, departamento, mte });
      }
    });

    const obra = {
      cnpj, nome, logradouro, numero, cep, bairro, municipio, uf,
      equipeEng: equipeEng.length ? equipeEng : [{ nome: '', funcao: '', crea: '', telefone: '', empresa: '' }],
      equipeSST: equipeSST.length ? equipeSST : [{ nome: '', funcao: '', telefone: '', departamento: '', mte: '' }]
    };

    console.log("[ui] salvar obra", { nome });
    await salvarObra(obra);
    
    if (typeof window.closeModal === "function") {
      window.closeModal("modalObra");
    }
    
    safeToast("Obra salva com sucesso!", "success");
  } catch (e) {
    console.error("ERRO AO SALVAR OBRA:", e);
    safeToast(e?.message || "Erro ao salvar obra", "error");
  }
};

// ==============================
// UI NAVEGAÃ‡ÃƒO
// ==============================

window.showPage = function showPage(id, el) {
  if (id === "admin" && !requirePermission(window.canManageUsers, "Aba Admin disponÃ­vel apenas para administradores.")) {
    return;
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  if (el) el.classList.add('active');

  const titles = {
    'dashboard': 'Dashboard',
    'terceirizados': 'Funcion\u00e1rios Terceirizados',
    'atacarejo': 'Funcion\u00e1rios Novo Atacarejo',
    'empresas': 'Gest\u00e3o de Empresas',
    'ata-terc': 'Ata de Libera\u00e7\u00e3o de Terceiros',
    'ata-atac': 'Ata de Libera\u00e7\u00e3o - Novo Atacarejo',
    'frequencia': 'Controle de Frequ\u00eancia'
  };

  const topbarTitle = document.getElementById('topbarTitle');
  if (topbarTitle) topbarTitle.textContent = titles[id] || id;

  if (id === 'ata-terc' && typeof window.renderAta === 'function') {
    window.renderAta('terceirizado');
  }
  if (id === 'ata-atac' && typeof window.renderAta === 'function') {
    window.renderAta('Novo Atacarejo');
  }
  if (id === 'empresas' && typeof window.renderEmpresas === 'function') {
    window.renderEmpresas();
  }
  if (id === 'frequencia' && typeof window.freqInit === 'function') {
    window.freqInit();
  }
  if (id === 'admin') {
    renderAdminUsers();
  }
};

window.toggleSidebar = function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sidebarOverlay')?.classList.toggle('open');
};

window.openModal = function openModal(id) {
  document.getElementById(id)?.classList.add('open');
};

window.closeModal = function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
};

window.showTab = function showTab(id, el) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  if (el) el.classList.add('active');
};

const originalOpenCadastroModal = window.openCadastroModal;
window.openCadastroModal = function openCadastroModalWithPermission(tipo) {
  if (!requirePermission(window.canEditFuncionarios, "Seu perfil nÃ£o pode cadastrar funcionÃ¡rios.")) return;
  return typeof originalOpenCadastroModal === "function" ? originalOpenCadastroModal(tipo) : undefined;
};

const originalEditFuncionario = window.editFuncionario;
window.editFuncionario = function editFuncionarioWithPermission(id) {
  if (!requirePermission(window.canEditFuncionarios, "Seu perfil nÃ£o pode editar funcionÃ¡rios.")) return;
  return typeof originalEditFuncionario === "function" ? originalEditFuncionario(id) : undefined;
};

const originalOpenEmpresaModal = window.openEmpresaModal;
window.openEmpresaModal = function openEmpresaModalWithPermission(id) {
  if (!requirePermission(window.canEditEmpresas, "Seu perfil nÃ£o pode cadastrar empresas.")) return;
  return typeof originalOpenEmpresaModal === "function" ? originalOpenEmpresaModal(id) : undefined;
};

const originalOpenObraModal = window.openObraModal;
window.openObraModal = function openObraModalWithPermission() {
  if (!requirePermission(window.canEditObra, "Apenas administradores podem editar a obra.")) return;
  return typeof originalOpenObraModal === "function" ? originalOpenObraModal() : undefined;
};

const originalFreqCtxApply = window.freqCtxApply;
window.freqCtxApply = function freqCtxApplyWithPermission(status) {
  if (!requirePermission(window.canEditFrequencia, "Seu perfil nÃ£o pode editar a frequÃªncia.")) return;
  return typeof originalFreqCtxApply === "function" ? originalFreqCtxApply(status) : undefined;
};

const originalOpenFeriadoModal = window.openFeriadoModal;
window.openFeriadoModal = function openFeriadoModalWithPermission() {
  if (!requirePermission(window.canEditFrequencia, "Seu perfil nÃ£o pode editar a frequÃªncia.")) return;
  return typeof originalOpenFeriadoModal === "function" ? originalOpenFeriadoModal() : undefined;
};

const originalOpenFeriadoTodosModal = window.openFeriadoTodosModal;
window.openFeriadoTodosModal = function openFeriadoTodosModalWithPermission() {
  if (!requirePermission(window.canEditFrequencia, "Seu perfil nÃ£o pode editar a frequÃªncia.")) return;
  return typeof originalOpenFeriadoTodosModal === "function" ? originalOpenFeriadoTodosModal() : undefined;
};

const originalAplicarFolgaFimDeSemana = window.aplicarFolgaFimDeSemana;
window.aplicarFolgaFimDeSemana = function aplicarFolgaFimDeSemanaWithPermission() {
  if (!requirePermission(window.canEditFrequencia, "Seu perfil nÃ£o pode editar a frequÃªncia.")) return;
  return typeof originalAplicarFolgaFimDeSemana === "function" ? originalAplicarFolgaFimDeSemana() : undefined;
};

const originalExportBackup = window.exportBackup;
window.exportBackup = function exportBackupWithPermission() {
  if (!requirePermission(window.canManageUsers, "Backup disponÃ­vel apenas para administradores.")) return;
  return typeof originalExportBackup === "function" ? originalExportBackup() : undefined;
};

const originalImportBackup = window.importBackup;
window.importBackup = function importBackupWithPermission(inputEl) {
  if (!requirePermission(window.canManageUsers, "ImportaÃ§Ã£o disponÃ­vel apenas para administradores.")) {
    if (inputEl) inputEl.value = "";
    return;
  }
  return typeof originalImportBackup === "function" ? originalImportBackup(inputEl) : undefined;
};

const originalExportAtaPDF = window.exportAtaPDF;
window.exportAtaPDF = function exportAtaPDFWithPermission(tipo) {
  if (!requirePermission(window.canExportDocumentos, "Seu perfil nÃ£o pode exportar atas.")) return;
  return typeof originalExportAtaPDF === "function" ? originalExportAtaPDF(tipo) : undefined;
};

const originalExportAtaExcel = window.exportAtaExcel;
window.exportAtaExcel = function exportAtaExcelWithPermission(tipo) {
  if (!requirePermission(window.canExportDocumentos, "Seu perfil nÃ£o pode exportar atas.")) return;
  return typeof originalExportAtaExcel === "function" ? originalExportAtaExcel(tipo) : undefined;
};

const originalFreqExportPDF = window.freqExportPDF;
window.freqExportPDF = function freqExportPDFWithPermission() {
  if (!requirePermission(window.canExportDocumentos, "Seu perfil nÃ£o pode exportar frequÃªncia.")) return;
  return typeof originalFreqExportPDF === "function" ? originalFreqExportPDF() : undefined;
};

const originalFreqExportExcel = window.freqExportExcel;
window.freqExportExcel = function freqExportExcelWithPermission() {
  if (!requirePermission(window.canExportDocumentos, "Seu perfil nÃ£o pode exportar frequÃªncia.")) return;
  return typeof originalFreqExportExcel === "function" ? originalFreqExportExcel() : undefined;
};

// ==============================
// REFRESH GERAL
// ==============================
window.refreshAll = function refreshAll() {
  const db = ensureDB();
  const freqState = ensureFreqState();
  const funcionarios = db.funcionarios;

  if (typeof window.refreshDashboard === "function") {
    window.refreshDashboard();
  }

  if (typeof window.renderDashTable === "function") {
    window.renderDashTable(funcionarios);
  }

  if (typeof window.renderTerceirizados === "function") {
    window.renderTerceirizados();
  }

  if (typeof window.renderAtacarejo === "function") {
    window.renderAtacarejo();
  }

  if (typeof window.renderEmpresas === "function") {
    window.renderEmpresas();
  }

  if (typeof window.updateEmpresasSuggestions === "function") {
    window.updateEmpresasSuggestions();
  }

  const activePageId = document.querySelector(".page.active")?.id;
  if (activePageId === "page-ata-terc" && typeof window.renderAta === "function") {
    window.renderAta("terceirizado");
  }
  if (activePageId === "page-ata-atac" && typeof window.renderAta === "function") {
    window.renderAta("Novo Atacarejo");
  }
  if (activePageId === "page-frequencia" && freqState.periodoKey && typeof window.freqRender === "function") {
    window.freqRender();
  }

  const obraName = typeof window.getObraDisplayName === "function"
    ? window.getObraDisplayName()
    : "Novo Atacarejo";

  const atacTitle = document.getElementById("atacarejoTitle");
  if (atacTitle) {
    atacTitle.textContent = `FuncionÃ¡rios ${obraName}`;
  }
};

// InicializaÃ§Ã£o
document.addEventListener("DOMContentLoaded", () => {
  ensureDB();
  ensureCurrentUserProfile();
  updatePermissionUI();
  renderAdminUsers();
  if (typeof window.initDarkMode === "function") window.initDarkMode();
});

window.__mainLoaded = true;
/*
    safeToast("SessÃ£o autenticada.", "success");
  } catch (e) {
    console.error("ERRO AO CARREGAR PERFIL:", e);
    safeToast(e?.message || "Erro ao carregar permissÃµes do usuÃ¡rio.", "error");
    await logout();
  }
  } catch (e) {
    console.error("ERRO AO CARREGAR PERFIL:", e);
    safeToast(e?.message || "Erro ao carregar permissÃµes do usuÃ¡rio.", "error");
    await logout();
  }
  } catch (e) {
    console.error("ERRO AO CARREGAR PERFIL:", e);
    safeToast(e?.message || "Erro ao carregar permissÃµes do usuÃ¡rio.", "error");
    await logout();
  }
});
*/
