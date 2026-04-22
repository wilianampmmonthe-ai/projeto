function $(id) {
  return document.getElementById(id);
}

const PAGE_TITLES = {
  dashboard: "Dashboard",
  terceirizados: "Funcionários Terceirizados",
  atacarejo: "Funcionários Novo Atacarejo",
  empresas: "Gestão de Empresas",
  "ata-terc": "Ata de Liberação de Terceiros",
  "ata-atac": "Ata de Liberação - Novo Atacarejo",
  frequencia: "Controle de Frequência",
  admin: "Admin",
};

const obraSelectorState = window.__obraSelectorState || (window.__obraSelectorState = {
  namesById: {},
  metaById: {},
  availableObras: [],
});

function normalizeObraId(obraId) {
  return String(obraId || "").trim().toLowerCase();
}

function normalizeRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return ["admin", "editor", "viewer"].includes(normalized) ? normalized : "";
}

function ensureAppContext() {
  const ctx = window.APP_CTX || (window.APP_CTX = {
    userId: null,
    obraAtivaId: null,
    obrasPermitidas: [],
    obraNome: "",
    obraCidade: "",
    obraUF: "",
    activeRole: null,
    accessSource: "none",
    canViewCurrentObra: false,
    accessEntry: null,
  });

  if (!Object.prototype.hasOwnProperty.call(ctx, "userId")) ctx.userId = null;
  if (!Array.isArray(ctx.obrasPermitidas)) ctx.obrasPermitidas = [];
  if (!Object.prototype.hasOwnProperty.call(ctx, "obraNome")) ctx.obraNome = "";
  if (!Object.prototype.hasOwnProperty.call(ctx, "obraCidade")) ctx.obraCidade = "";
  if (!Object.prototype.hasOwnProperty.call(ctx, "obraUF")) ctx.obraUF = "";
  if (!Object.prototype.hasOwnProperty.call(ctx, "activeRole")) ctx.activeRole = null;
  if (!Object.prototype.hasOwnProperty.call(ctx, "accessSource")) ctx.accessSource = "none";
  if (!Object.prototype.hasOwnProperty.call(ctx, "canViewCurrentObra")) ctx.canViewCurrentObra = false;
  if (!Object.prototype.hasOwnProperty.call(ctx, "accessEntry")) ctx.accessEntry = null;

  if (!Object.prototype.hasOwnProperty.call(ctx, "obraAtivaId") || ctx.obraAtivaId === undefined) {
    try {
      ctx.obraAtivaId = normalizeObraId(localStorage.getItem("obraAtivaId")) || null;
    } catch (error) {
      ctx.obraAtivaId = null;
    }
  }

  ctx.obraAtivaId = normalizeObraId(ctx.obraAtivaId) || null;

  return ctx;
}

function getStoredObraAtivaId() {
  try {
    return normalizeObraId(localStorage.getItem("obraAtivaId")) || null;
  } catch (error) {
    return null;
  }
}

function persistObraAtivaId(obraAtivaId) {
  try {
    const normalized = normalizeObraId(obraAtivaId);
    if (normalized) {
      localStorage.setItem("obraAtivaId", normalized);
    } else {
      localStorage.removeItem("obraAtivaId");
    }
  } catch (error) {
    console.warn("Não foi possível persistir obraAtivaId no localStorage.", error);
  }
}

function normalizeAllowedObras(rawObras) {
  if (Array.isArray(rawObras)) {
    return rawObras
      .map((obraId) => normalizeObraId(obraId))
      .filter(Boolean);
  }

  if (rawObras && typeof rawObras === "object") {
    return Object.keys(rawObras)
      .filter((obraId) => Boolean(rawObras[obraId]))
      .map((obraId) => normalizeObraId(obraId))
      .filter(Boolean);
  }

  return [];
}

function getEnabledObrasFromAcessos(profile) {
  if (!profile?.acessos || typeof profile.acessos !== "object" || Array.isArray(profile.acessos)) {
    return [];
  }

  const enabled = new Set();
  Object.entries(profile.acessos).forEach(([obraId, entry]) => {
    const normalizedObraId = normalizeObraId(obraId);
    if (!normalizedObraId) return;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    if (entry.enabled === true) enabled.add(normalizedObraId);
  });

  return Array.from(enabled);
}

function normalizeAccessMap(rawAcessos) {
  if (!rawAcessos || typeof rawAcessos !== "object" || Array.isArray(rawAcessos)) return {};

  return Object.entries(rawAcessos).reduce((acc, [obraId, entry]) => {
    const normalizedObraId = normalizeObraId(obraId);
    if (!normalizedObraId || !entry || typeof entry !== "object" || Array.isArray(entry)) return acc;

    acc[normalizedObraId] = {
      enabled: entry.enabled !== false,
      role: normalizeRole(entry.role) || "viewer",
    };
    return acc;
  }, {});
}

function getLegacyObrasMap(rawObras) {
  return normalizeAllowedObras(rawObras).reduce((acc, obraId) => {
    acc[obraId] = true;
    return acc;
  }, {});
}

function getPermittedObras(profile) {
  const permitted = new Set(Object.keys(getLegacyObrasMap(profile?.obras)));

  getEnabledObrasFromAcessos(profile).forEach((obraId) => {
    permitted.add(obraId);
  });

  Object.entries(normalizeAccessMap(profile?.acessos)).forEach(([obraId, entry]) => {
    if (!entry.enabled) permitted.delete(obraId);
  });

  return Array.from(permitted);
}

function getAccessEntryForObraId(obraId, profile) {
  const normalizedObraId = normalizeObraId(obraId);
  if (!normalizedObraId) return null;

  const currentProfile = profile || ensureCurrentUserProfile();
  return normalizeAccessMap(currentProfile.acessos)[normalizedObraId] || null;
}

function resolveLegacyAccessForObra(profile, obraId) {
  const normalizedObraId = normalizeObraId(obraId);
  if (!normalizedObraId) return null;

  const legacyObras = getLegacyObrasMap(profile?.obras);
  const hasLegacyObras = Object.keys(legacyObras).length > 0;
  const globalRole = normalizeRole(profile?.role) || "viewer";

  if (hasLegacyObras && !legacyObras[normalizedObraId]) {
    return null;
  }

  return {
    enabled: true,
    role: globalRole,
    source: hasLegacyObras ? "fallback:obras+role" : "fallback:role-global",
  };
}

function resolveAccessForObra(profile, obraId) {
  const normalizedObraId = normalizeObraId(obraId);
  if (!normalizedObraId) {
    return { canView: false, role: "", source: "none", entry: null };
  }

  const accessEntry = getAccessEntryForObraId(normalizedObraId, profile);
  if (accessEntry) {
    if (!accessEntry.enabled) {
      return { canView: false, role: "", source: "acessos:disabled", entry: accessEntry };
    }

    return {
      canView: true,
      role: accessEntry.role || "viewer",
      source: "acessos",
      entry: accessEntry,
    };
  }

  const legacyEntry = resolveLegacyAccessForObra(profile, normalizedObraId);
  if (legacyEntry) {
    return {
      canView: true,
      role: legacyEntry.role || "viewer",
      source: legacyEntry.source,
      entry: legacyEntry,
    };
  }

  return { canView: false, role: "", source: "none", entry: null };
}

function humanizeObraId(obraId) {
  return normalizeObraId(obraId)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveObraAtivaId(profile, obrasPermitidas) {
  const allowed = Array.isArray(obrasPermitidas) ? obrasPermitidas : [];
  const saved = getStoredObraAtivaId();
  const preferred = normalizeObraId(profile?.obraAtivaId);

  if (saved && allowed.includes(saved) && resolveAccessForObra(profile, saved).canView) return saved;

  for (const obraId of allowed) {
    if (resolveAccessForObra(profile, obraId).canView) return obraId;
  }

  const fallbackCandidates = [preferred, saved]
    .map((obraId) => normalizeObraId(obraId))
    .filter(Boolean)
    .filter((obraId, index, list) => list.indexOf(obraId) === index);

  for (const obraId of fallbackCandidates) {
    if (resolveAccessForObra(profile, obraId).canView) return obraId;
  }

  return null;
}

function logPermissionDebug(evento, detalhes) {
  console.log(`[perm] ${evento}`, {
    obraAtivaId: ensureAppContext().obraAtivaId,
    activeRole: ensureAppContext().activeRole,
    source: ensureAppContext().accessSource,
    ...(detalhes || {}),
  });
}

function syncAppContext(user, profile) {
  const ctx = ensureAppContext();
  const obrasPermitidas = getPermittedObras(profile);
  const obrasDisponiveis = getAvailableObrasForUser(profile);
  const obraAtivaId = normalizeObraId(resolveObraAtivaId(profile, obrasPermitidas));
  const accessResolution = resolveAccessForObra(profile, obraAtivaId);

  ctx.userId = String(user?.uid || "");
  ctx.obrasPermitidas = obrasPermitidas;
  ctx.obraAtivaId = obraAtivaId;
  ctx.activeRole = accessResolution.role || null;
  ctx.accessSource = accessResolution.source || "none";
  ctx.canViewCurrentObra = Boolean(accessResolution.canView);
  ctx.accessEntry = accessResolution.entry ? JSON.parse(JSON.stringify(accessResolution.entry)) : null;

  persistObraAtivaId(obraAtivaId);
  logPermissionDebug("contexto-resolvido", {
    obrasPermitidas,
    canViewCurrentObra: ctx.canViewCurrentObra,
  });
  console.debug("[obra-selector] obras disponiveis", {
    userId: ctx.userId,
    obraIds: obrasDisponiveis,
  });
  console.debug("[obra-selector] obra ativa resolvida", {
    obraAtivaId,
  });
  return ctx;
}

function getCurrentPageId() {
  const activePage = document.querySelector(".page.active")?.id || "";
  return activePage.replace(/^page-/, "") || "dashboard";
}

function updateTopbarTitle(pageId) {
  const topbarTitle = document.getElementById("topbarTitle");
  if (!topbarTitle) return;

  const targetPageId = pageId || getCurrentPageId();
  const baseTitle = PAGE_TITLES[targetPageId] || targetPageId;

  topbarTitle.textContent = baseTitle;
  topbarTitle.setAttribute("title", baseTitle);

  if (typeof window.updateObraSelectorLabel === "function") {
    window.updateObraSelectorLabel();
  }
}

window.updateTopbarTitle = updateTopbarTitle;

function getObraSelectorElements() {
  return {
    wrapper: document.getElementById("obra-switcher"),
    label: document.querySelector("#obra-switcher .topbar-obra-label"),
    select: document.getElementById("obra-selector"),
    currentName: document.getElementById("obra-current-name"),
  };
}

function getAvailableObrasForUser(profile) {
  const enabledFromAcessos = getEnabledObrasFromAcessos(profile);
  if (enabledFromAcessos.length) return enabledFromAcessos;
  return getPermittedObras(profile);
}

function getFriendlyObraName(obraId) {
  const normalizedObraId = normalizeObraId(obraId);
  if (!normalizedObraId) return "";

  const cachedMeta = obraSelectorState.metaById[normalizedObraId] || null;
  const cachedName = cachedMeta?.nome || obraSelectorState.namesById[normalizedObraId];
  const activeObraId = normalizeObraId(ensureAppContext().obraAtivaId);
  if (normalizedObraId === activeObraId && typeof window.getObraDisplayName === "function") {
    const liveName = String(window.getObraDisplayName() || "").trim();
    if (window.DB?.obra?.nome && liveName) return liveName;
    if (!cachedName && liveName) return liveName;
  }

  return cachedName || humanizeObraId(normalizedObraId);
}

async function loadFriendlyObraNames(obraIds) {
  const uniqueObras = Array.isArray(obraIds)
    ? obraIds
      .map((obraId) => normalizeObraId(obraId))
      .filter(Boolean)
      .filter((obraId, index, list) => list.indexOf(obraId) === index)
    : [];

  if (!uniqueObras.length || !window.firebase?.firestore) return obraSelectorState.namesById;

  await Promise.all(uniqueObras.map(async (obraId) => {
    if (obraSelectorState.metaById[obraId]?.nome) return;

    try {
      const snap = await firebase.firestore().collection("obras").doc(obraId).get();
      const data = snap.data() || {};
      const nome = String(data.nome || "").trim();
      const municipio = String(data.municipio || "").trim();
      const uf = String(data.uf || "").trim();
      if (snap.exists && nome) {
        obraSelectorState.namesById[obraId] = nome;
        obraSelectorState.metaById[obraId] = { nome, municipio, uf };

        const activeObraId = normalizeObraId(ensureAppContext().obraAtivaId);
        if (obraId === activeObraId) {
          const ctx = ensureAppContext();
          ctx.obraNome = nome;
          ctx.obraCidade = municipio;
          ctx.obraUF = uf;
          if (typeof window.updateObraInterface === "function") {
            window.updateObraInterface();
          }
        }
      }
    } catch (error) {
      console.debug("[obra-selector] nome-amigavel indisponivel", { obraId, error });
    }
  }));

  return obraSelectorState.namesById;
}

function resetObraSelectorUI() {
  const { wrapper, label, select, currentName } = getObraSelectorElements();
  if (wrapper) wrapper.hidden = true;
  if (label) label.hidden = false;
  if (currentName) {
    currentName.hidden = true;
    currentName.textContent = "";
  }
  if (select) {
    select.hidden = true;
    select.disabled = true;
    select.replaceChildren();
    select.value = "";
  }
  obraSelectorState.availableObras = [];
}

window.getCachedObraMeta = function getCachedObraMeta(obraId) {
  const normalizedObraId = normalizeObraId(obraId);
  if (!normalizedObraId) return null;
  return obraSelectorState.metaById[normalizedObraId] || null;
};

function updateObraSelectorLabel() {
  const { wrapper, select, currentName } = getObraSelectorElements();
  if (!wrapper || wrapper.hidden || !currentName) return;

  const activeObraId = normalizeObraId(ensureAppContext().obraAtivaId);
  const activeObraName = getFriendlyObraName(activeObraId);

  currentName.textContent = activeObraName;
  currentName.title = activeObraName ? `Obra ativa: ${activeObraName}` : "Obra ativa";

  if (select && !select.hidden && activeObraId && Array.isArray(obraSelectorState.availableObras)) {
    if (obraSelectorState.availableObras.includes(activeObraId)) {
      select.value = activeObraId;
    }
  }
}

window.updateObraSelectorLabel = updateObraSelectorLabel;

function handleObraSelectorChange(event) {
  const nextObraId = normalizeObraId(event?.target?.value);
  const ctx = ensureAppContext();
  const currentObraId = normalizeObraId(ctx.obraAtivaId);

  if (!nextObraId || nextObraId === currentObraId) return;

  persistObraAtivaId(nextObraId);
  ctx.obraAtivaId = nextObraId;

  console.debug("[obra-selector] troca de obra realizada", {
    from: currentObraId,
    to: nextObraId,
  });

  updateObraSelectorLabel();
  updateTopbarTitle();
  window.location.reload();
}

async function refreshObraSelector(profile) {
  const { wrapper, label, select, currentName } = getObraSelectorElements();
  const user = fb.auth.currentUser;

  if (!wrapper || !select || !currentName || !user) {
    resetObraSelectorUI();
    return;
  }

  const availableObras = getAvailableObrasForUser(profile);
  obraSelectorState.availableObras = availableObras.slice();

  console.debug("[obra-selector] obras disponiveis", {
    userId: String(user.uid || ""),
    obraIds: availableObras,
  });

  if (!availableObras.length) {
    resetObraSelectorUI();
    return;
  }

  await loadFriendlyObraNames(availableObras);

  wrapper.hidden = false;
  if (label) label.hidden = availableObras.length < 2;
  currentName.hidden = availableObras.length > 1;
  select.hidden = availableObras.length < 2;
  select.disabled = availableObras.length < 2;
  select.onchange = handleObraSelectorChange;

  select.replaceChildren();
  if (availableObras.length > 1) {
    availableObras.forEach((obraId) => {
      const option = document.createElement("option");
      option.value = obraId;
      option.textContent = getFriendlyObraName(obraId);
      select.appendChild(option);
    });
  }

  updateObraSelectorLabel();

  console.debug("[obra-selector] obra ativa resolvida", {
    obraAtivaId: normalizeObraId(ensureAppContext().obraAtivaId),
  });
}

window.getAccessEntryForActiveObra = function getAccessEntryForActiveObra() {
  return ensureAppContext().accessEntry || null;
};

window.getActiveObraRole = function getActiveObraRole() {
  return normalizeRole(ensureAppContext().activeRole);
};

window.canViewCurrentObra = function canViewCurrentObra() {
  return Boolean(ensureAppContext().canViewCurrentObra);
};

window.canEditDadosObra = function canEditDadosObra() {
  return window.canViewCurrentObra() && window.getActiveObraRole() === "admin";
};

window.canManageAccess = function canManageAccess() {
  return window.canViewCurrentObra() && window.getActiveObraRole() === "admin";
};

function persistFreqCacheState(data) {
  try {
    if (typeof window.writeFreqCache === "function") {
      window.writeFreqCache(data);
      return;
    }

    localStorage.setItem("frequencia", JSON.stringify(data || {}));
  } catch (e) {
    console.error("Erro ao persistir frequencia localmente:", e);
  }
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
  if (!/[ÃÂâ]/.test(text)) return text;

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
    ["Ãƒ", "Ã"], ["Ã‚", "Â"],
    ["â€”", "—"], ["â€“", "–"], ["â€¢", "•"], ["â—", "●"], ["â˜°", "☰"], ["Ã—", "×"],
    ["Ã¢Å“ÂÃ¯Â¸Â", ""], ["Ã°Å¸â€”â€˜Ã¯Â¸Â", ""],
    [" Â· ", " • "], ["Â·", "•"], ["Â •", " •"], ["•Â", "•"],
    [" Â ", " "], ["Âº", "º"], ["Âª", "ª"], ["Â", ""]
  ];

  for (let pass = 0; pass < 4; pass += 1) {
    const before = text;
    replacements.forEach(([from, to]) => {
      text = text.split(from).join(to);
    });
    if (text === before) break;
  }

  return text;
}

function normalizeDocumentText(root) {
  const targetRoot = root || document.body;
  if (!targetRoot) return;

  const textWalker = document.createTreeWalker(targetRoot, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentTag = node.parentElement?.tagName || "";
      if (["SCRIPT", "STYLE"].includes(parentTag)) return NodeFilter.FILTER_REJECT;
      return /[ÃÂâ]/.test(node.nodeValue || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  const textNodes = [];
  while (textWalker.nextNode()) textNodes.push(textWalker.currentNode);
  textNodes.forEach((node) => {
    node.nodeValue = normalizeUiText(node.nodeValue);
  });

  targetRoot.querySelectorAll("*").forEach((el) => {
    ["placeholder", "title", "aria-label"].forEach((attr) => {
      const current = el.getAttribute(attr);
      if (current && /[ÃÂâ]/.test(current)) {
        el.setAttribute(attr, normalizeUiText(current));
      }
    });
  });

  document.title = normalizeUiText(document.title);
}

window.normalizeDocumentText = normalizeDocumentText;

const CONFIRM_MODAL_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.6 19a1 1 0 0 0 .86 1.5h17.08a1 1 0 0 0 .86-1.5Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
const confirmModalState = window.__confirmModalState || (window.__confirmModalState = {
  resolve: null,
  lastFocused: null,
});

function getConfirmModalElements() {
  return {
    overlay: $("confirmModal"),
    icon: $("confirmModalIcon"),
    title: $("confirmModalTitle"),
    message: $("confirmModalMessage"),
    confirmButton: $("confirmModalConfirmBtn"),
    cancelButton: $("confirmModalCancelBtn"),
  };
}

window.resolveConfirmModal = function resolveConfirmModal(confirmed) {
  const elements = getConfirmModalElements();
  if (elements.overlay) {
    elements.overlay.classList.remove("open");
    elements.overlay.setAttribute("aria-hidden", "true");
  }

  const resolve = confirmModalState.resolve;
  confirmModalState.resolve = null;

  if (confirmModalState.lastFocused && typeof confirmModalState.lastFocused.focus === "function") {
    confirmModalState.lastFocused.focus();
  }
  confirmModalState.lastFocused = null;

  if (typeof resolve === "function") {
    resolve(Boolean(confirmed));
  }
};

window.openConfirmModal = function openConfirmModal(options = {}) {
  const elements = getConfirmModalElements();
  if (!elements.overlay || !elements.title || !elements.message || !elements.confirmButton || !elements.cancelButton || !elements.icon) {
    console.error("Modal de confirmação não encontrado.");
    return Promise.resolve(false);
  }

  if (typeof confirmModalState.resolve === "function") {
    window.resolveConfirmModal(false);
  }

  const variant = String(options.variant || "default").toLowerCase();
  const isDanger = variant === "danger";
  const title = normalizeUiText(options.title || "Confirmar ação");
  const message = normalizeUiText(options.message || "Tem certeza que deseja continuar?");
  const confirmText = normalizeUiText(options.confirmText || "Confirmar");
  const cancelText = normalizeUiText(options.cancelText || "Cancelar");

  elements.title.textContent = title;
  elements.message.textContent = message;
  elements.confirmButton.textContent = confirmText;
  elements.cancelButton.textContent = cancelText;
  elements.confirmButton.className = isDanger ? "btn btn-danger" : "btn btn-primary";
  elements.icon.className = `confirm-modal__icon${isDanger ? " is-danger" : ""}`;
  elements.icon.innerHTML = CONFIRM_MODAL_ICON;
  elements.overlay.classList.add("open");
  elements.overlay.setAttribute("aria-hidden", "false");
  confirmModalState.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  return new Promise((resolve) => {
    confirmModalState.resolve = resolve;
    setTimeout(() => {
      (elements.cancelButton || elements.confirmButton)?.focus?.();
    }, 0);
  });
};

document.addEventListener("click", (event) => {
  const overlay = $("confirmModal");
  if (overlay && overlay.classList.contains("open") && event.target === overlay) {
    window.resolveConfirmModal(false);
  }
}, true);

document.addEventListener("keydown", (event) => {
  const overlay = $("confirmModal");
  if (event.key === "Escape" && overlay && overlay.classList.contains("open")) {
    event.preventDefault();
    window.resolveConfirmModal(false);
  }
}, true);

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
  if (!Object.prototype.hasOwnProperty.call(profile, "obras")) profile.obras = {};
  if (!Object.prototype.hasOwnProperty.call(profile, "acessos")) profile.acessos = {};
  if (!Object.prototype.hasOwnProperty.call(profile, "obraAtivaId")) profile.obraAtivaId = "";
  return profile;
}

function getUserRole() {
  return window.getActiveObraRole();
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
  return window.canManageAccess();
};

window.canEditObra = function canEditObra() {
  return window.canEditDadosObra();
};

window.canEditFuncionarios = function canEditFuncionarios() {
  return window.canViewCurrentObra() && (window.isAdmin() || window.isEditor());
};

window.canEditEmpresas = function canEditEmpresas() {
  return window.canViewCurrentObra() && (window.isAdmin() || window.isEditor());
};

window.canEditFrequencia = function canEditFrequencia() {
  return window.canViewCurrentObra() && (window.isAdmin() || window.isEditor());
};

window.canExportDocumentos = function canExportDocumentos() {
  return window.canViewCurrentObra();
};

window.nlGetSessao = function nlGetSessao() {
  const user = fb.auth.currentUser;
  const profile = ensureCurrentUserProfile();
  const appCtx = ensureAppContext();
  return user ? {
    uid: String(user.uid),
    email: profile.email || user.email || "",
    tipoUsuario: window.getActiveObraRole() || profile.role || "viewer",
    status: profile.status || "active",
    obraAtivaId: appCtx.obraAtivaId || "",
  } : null;
};

function requirePermission(check, message) {
  if (typeof check === "function" && check()) return true;
  logPermissionDebug("acao-bloqueada", {
    message: message || "Permissão insuficiente.",
  });
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
    const currentRole = window.getActiveObraRole();
    const role = roleLabels[currentRole] || (window.canViewCurrentObra() ? "Visualizador" : "Sem acesso");
    const status = statusLabels[profile.status] || "Ativo";
    roleEl.textContent = normalizeUiText(`${role} • ${status}`);
  }
}

function updatePermissionUI() {
  const canView = window.canViewCurrentObra();
  const canAdmin = window.canManageUsers();
  const canObra = window.canEditDadosObra();
  const canFuncionarios = window.canEditFuncionarios();
  const canEmpresas = window.canEditEmpresas();
  const canFreq = window.canEditFrequencia();
  const canExport = window.canExportDocumentos();

  setElementVisible("#nav-admin-section", canAdmin);
  setElementVisible("#nav-obra-item", canView);
  setElementVisible("#adminBackupSection", canAdmin);

  setElementVisible("#btnNovoFuncionarioDashboard", canFuncionarios);
  setElementVisible("#btnNovoTerceirizado", canFuncionarios);
  setElementVisible("#btnNovoAtacarejo", canFuncionarios);
  setElementVisible("#btnNovaEmpresa", canEmpresas);
  setElementVisible("#btnSalvarObraModal", canObra);
  setElementVisible(".edit-btn", canFuncionarios);
  setElementVisible(".delete-btn", canFuncionarios || canEmpresas);

  setElementVisible("#page-frequencia .ctx-item", canFreq);
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
    role: normalizeRole(profile?.role) || "viewer",
    status: String(profile?.status || "active"),
    obras: getLegacyObrasMap(profile?.obras),
    acessos: normalizeAccessMap(profile?.acessos),
    obraAtivaId: normalizeObraId(profile?.obraAtivaId),
    createdAt: profile?.createdAt || null,
    updatedAt: profile?.updatedAt || null,
  };
}

async function loadCurrentUserProfile(user) {
  const profile = await ensureUsuarioProfile(user);
  const normalized = normalizeUserProfile(profile, user);
  window.currentUserProfile = normalized;
  syncAppContext(user, normalized);
  refreshObraSelector(normalized).catch((error) => {
    console.warn("[obra-selector] erro ao montar seletor", error);
  });
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
  persistFreqCacheState(state.data);

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
    persistFreqCacheState(freqState.data);
    if (typeof window.freqRender === "function") window.freqRender();
  });
}

window.syncFrequenciaListener = syncFrequenciaListener;

function wireRealtimeForUser() {
  stopRealtime();
  ensureDB();
  ensureAppContext();
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
    const appCtx = ensureAppContext();
    appCtx.userId = null;
    appCtx.obrasPermitidas = [];
    appCtx.obraAtivaId = getStoredObraAtivaId();
    appCtx.activeRole = null;
    appCtx.accessSource = "none";
    appCtx.canViewCurrentObra = false;
    appCtx.accessEntry = null;
    resetObraSelectorUI();
    setLoggedIn(false);
    updatePermissionUI();
    updateTopbarTitle();
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

    if (!window.canViewCurrentObra()) {
      logPermissionDebug("sem-acesso-a-obra", {
        userId: user.uid,
      });
      safeToast("Você não possui acesso à obra ativa.", "error");
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

    const confirmed = await window.openConfirmModal({
      title: "Excluir funcionário",
      message: "Tem certeza que deseja remover este funcionário permanentemente?",
      confirmText: "Excluir",
      cancelText: "Cancelar",
      variant: "danger",
    });
    if (!confirmed) return;

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

    const confirmed = await window.openConfirmModal({
      title: "Excluir empresa",
      message: "Tem certeza que deseja remover esta empresa? Os funcionários vinculados não serão afetados.",
      confirmText: "Excluir",
      cancelText: "Cancelar",
      variant: "danger",
    });
    if (!confirmed) return;

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
  updateTopbarTitle(id);

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
  if (!requirePermission(window.canViewCurrentObra, "Seu perfil não pode visualizar os dados da obra.")) return;
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

  updatePermissionUI();
  updateTopbarTitle();
  if (typeof window.normalizeDocumentText === "function") window.normalizeDocumentText();
};

// InicializaÃ§Ã£o
document.addEventListener("DOMContentLoaded", () => {
  ensureDB();
  ensureCurrentUserProfile();
  ensureAppContext();
  updatePermissionUI();
  renderAdminUsers();
  if (typeof window.initDarkMode === "function") window.initDarkMode();
  updateTopbarTitle();
  if (typeof window.normalizeDocumentText === "function") window.normalizeDocumentText();
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
