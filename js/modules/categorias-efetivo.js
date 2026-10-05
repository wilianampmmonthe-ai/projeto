(function () {
  "use strict";

  const DEFAULT_CATEGORIES = [
    { id: "padrao-indiretos", nome: "Indiretos", nomeNormalizado: "INDIRETOS" },
    { id: "padrao-civil", nome: "Civil", nomeNormalizado: "CIVIL" },
    { id: "padrao-terraplanagem", nome: "Terraplanagem", nomeNormalizado: "TERRAPLANAGEM" },
    { id: "padrao-estrutura-metalica", nome: "Estrutura / Metálica", nomeNormalizado: "ESTRUTURA_METALICA" },
    { id: "padrao-instalacoes", nome: "Instalações", nomeNormalizado: "INSTALACOES" },
    { id: "padrao-outros", nome: "Outros", nomeNormalizado: "OUTROS" },
  ].map((category, index) => ({ ...category, ordem: index + 1, ativa: true, virtual: true }));

  const LEGACY_ALIASES = {
    ESTRUTURA__METALICA: "ESTRUTURA_METALICA",
    ESTRUTURAS_METALICA: "ESTRUTURA_METALICA",
    TERRAPLENAGEM: "TERRAPLANAGEM",
    SERRALHARIA_OUTROS: "OUTROS",
  };

  const DELETE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';

  function cleanCategoryName(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeCategoryName(value) {
    const normalized = cleanCategoryName(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/\s*\/\s*/g, "_")
      .replace(/[^A-Z0-9_ -]/g, "")
      .replace(/[ -]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    return LEGACY_ALIASES[normalized] || normalized;
  }

  function normalizedCategory(raw, index) {
    if (typeof raw === "string") {
      const nome = cleanCategoryName(raw);
      const nomeNormalizado = normalizeCategoryName(nome);
      if (!nome || !nomeNormalizado) return null;
      const defaultMatch = DEFAULT_CATEGORIES.find((item) => item.nomeNormalizado === nomeNormalizado);
      return {
        id: defaultMatch?.id || `legado-${nomeNormalizado.toLowerCase().replace(/_/g, "-")}`,
        nome: defaultMatch?.nome || nome,
        nomeNormalizado,
        ordem: index + 1,
        ativa: true,
        createdAt: null,
        updatedAt: null,
        legacy: true,
      };
    }
    if (!raw || typeof raw !== "object") return null;
    const nome = cleanCategoryName(raw.nome || raw.name);
    const nomeNormalizado = normalizeCategoryName(raw.nomeNormalizado || nome);
    const id = cleanCategoryName(raw.id);
    if (!id || !nome || !nomeNormalizado) return null;
    return {
      id,
      nome,
      nomeNormalizado,
      nomesAnterioresNormalizados: Array.from(new Set(
        (Array.isArray(raw.nomesAnterioresNormalizados) ? raw.nomesAnterioresNormalizados : [])
          .map(normalizeCategoryName)
          .filter((item) => item && item !== nomeNormalizado)
      )),
      ordem: Number.isFinite(Number(raw.ordem)) ? Number(raw.ordem) : index + 1,
      ativa: raw.ativa !== false,
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || null,
    };
  }

  function sortCategories(categories) {
    return categories.slice().sort((a, b) => (
      Number(a.ordem) - Number(b.ordem)
      || a.nome.localeCompare(b.nome, "pt-BR")
    ));
  }

  function normalizeCategories(categories) {
    const seenIds = new Set();
    const seenNames = new Set();
    return sortCategories((Array.isArray(categories) ? categories : [])
      .map(normalizedCategory)
      .filter((category) => {
        if (!category || seenIds.has(category.id) || seenNames.has(category.nomeNormalizado)) return false;
        seenIds.add(category.id);
        seenNames.add(category.nomeNormalizado);
        return true;
      }))
      .map((category, index) => ({ ...category, ordem: index + 1 }));
  }

  function categoryUsesName(category, normalizedName) {
    return category.nomeNormalizado === normalizedName
      || category.nomesAnterioresNormalizados?.includes(normalizedName);
  }

  function createCategoryRecord(categories, name, options) {
    const normalized = normalizeCategories(categories);
    const nome = cleanCategoryName(name);
    const nomeNormalizado = normalizeCategoryName(nome);
    if (!nome || !nomeNormalizado) throw new Error("Informe o nome da categoria.");
    if (normalized.some((category) => categoryUsesName(category, nomeNormalizado))) {
      throw new Error("Já existe uma categoria com esse nome nesta obra.");
    }
    const now = options?.now || new Date().toISOString();
    return normalizeCategories([...normalized, {
      id: options?.id || crypto.randomUUID(),
      nome,
      nomeNormalizado,
      ordem: normalized.length + 1,
      ativa: true,
      nomesAnterioresNormalizados: [],
      createdAt: now,
      updatedAt: now,
    }]);
  }

  function renameCategoryRecord(categories, id, name, now) {
    const normalized = normalizeCategories(categories);
    const nome = cleanCategoryName(name);
    const nomeNormalizado = normalizeCategoryName(nome);
    if (!nome || !nomeNormalizado) throw new Error("O nome da categoria não pode ficar vazio.");
    if (!normalized.some((category) => category.id === id)) throw new Error("Categoria não encontrada.");
    if (normalized.some((category) => category.id !== id && categoryUsesName(category, nomeNormalizado))) {
      throw new Error("Já existe uma categoria com esse nome nesta obra.");
    }
    return normalized.map((category) => {
      if (category.id !== id) return category;
      const previousNames = category.nomeNormalizado === nomeNormalizado
        ? (category.nomesAnterioresNormalizados || [])
        : [...(category.nomesAnterioresNormalizados || []), category.nomeNormalizado];
      return {
        ...category,
        nome,
        nomeNormalizado,
        nomesAnterioresNormalizados: Array.from(new Set(previousNames))
          .filter((item) => item !== nomeNormalizado),
        updatedAt: now || new Date().toISOString(),
      };
    });
  }

  function toggleCategoryRecord(categories, id, now) {
    const normalized = normalizeCategories(categories);
    if (!normalized.some((category) => category.id === id)) throw new Error("Categoria não encontrada.");
    return normalized.map((category) => category.id === id
      ? { ...category, ativa: !category.ativa, updatedAt: now || new Date().toISOString() }
      : category);
  }

  function moveCategoryRecord(categories, id, direction, now) {
    const normalized = normalizeCategories(categories);
    const index = normalized.findIndex((category) => category.id === id);
    const target = index + Number(direction);
    if (index < 0 || target < 0 || target >= normalized.length) return normalized;
    const affectedIds = new Set([normalized[index].id, normalized[target].id]);
    [normalized[index], normalized[target]] = [normalized[target], normalized[index]];
    return normalized.map((category, categoryIndex) => ({
      ...category,
      ordem: categoryIndex + 1,
      updatedAt: affectedIds.has(category.id) ? (now || new Date().toISOString()) : category.updatedAt,
    }));
  }

  function companyUsesCategory(company, category, categories) {
    if (!company || !category) return false;
    const categoryId = cleanCategoryName(company.categoriaEfetivoId || company.categoryId);
    if (categoryId) {
      if (categoryId === category.id) return true;
      const referencesAnotherCategory = normalizeCategories(categories)
        .some((item) => item.id === categoryId);
      if (referencesAnotherCategory) return false;
    }

    const legacyName = normalizeCategoryName(
      company.categoriaEfetivo || company.categoria || company.categoryName
    );
    return Boolean(legacyName && categoryUsesName(category, legacyName));
  }

  function isCategoryLinkedToCompanies(category, companies, categories) {
    return (Array.isArray(companies) ? companies : [])
      .some((company) => companyUsesCategory(company, category, categories));
  }

  function removeCategoryRecord(categories, id) {
    const normalized = normalizeCategories(categories);
    const targetId = cleanCategoryName(id);
    if (!normalized.some((category) => category.id === targetId)) {
      throw new Error("Categoria não encontrada.");
    }
    return normalizeCategories(normalized.filter((category) => category.id !== targetId));
  }

  function getStore() {
    const db = window.DB || (window.DB = {});
    if (!Array.isArray(db.efetivoCategorias)) db.efetivoCategorias = [];
    if (typeof db.efetivoCategoriasConfiguradas !== "boolean") db.efetivoCategoriasConfiguradas = false;
    return db;
  }

  function applyCategoriesPayload(payload) {
    const db = getStore();
    const categories = normalizeCategories(payload?.categorias);
    db.efetivoCategoriasConfiguradas = payload?.exists === true && categories.length > 0;
    db.efetivoCategorias = db.efetivoCategoriasConfiguradas
      ? categories
      : DEFAULT_CATEGORIES.map((category) => ({ ...category }));
    renderCategoryManager();
    populateCompanyCategorySelect();
    if (typeof window.efetivoRefresh === "function") window.efetivoRefresh();
  }

  function getCategories(options) {
    const includeInactive = options?.includeInactive === true;
    const categories = getStore().efetivoCategorias.length
      ? getStore().efetivoCategorias
      : DEFAULT_CATEGORIES;
    return sortCategories(categories)
      .filter((category) => includeInactive || category.ativa)
      .map((category) => ({ ...category }));
  }

  function getCategoryById(id, options) {
    const target = cleanCategoryName(id);
    if (!target) return null;
    return getCategories({ includeInactive: options?.includeInactive === true })
      .find((category) => category.id === target) || null;
  }

  function resolveCategory(company, options) {
    const includeInactive = options?.includeInactive !== false;
    const categories = getCategories({ includeInactive: true });
    const categoryId = cleanCategoryName(company?.categoriaEfetivoId || company?.categoryId);
    let category = categoryId ? categories.find((item) => item.id === categoryId) : null;
    if (!category) {
      const legacyName = normalizeCategoryName(company?.categoriaEfetivo || company?.categoria || company?.categoryName);
      category = categories.find((item) => categoryUsesName(item, legacyName)) || null;
    }
    if (!category) {
      category = categories.find((item) => item.nomeNormalizado === "OUTROS")
        || DEFAULT_CATEGORIES.find((item) => item.nomeNormalizado === "OUTROS");
    }
    if (!includeInactive && category?.ativa === false) return null;
    return category ? { ...category } : null;
  }

  function escapeHtml(value) {
    return cleanCategoryName(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function canEdit() {
    return typeof window.canEditEmpresas === "function" && window.canEditEmpresas();
  }

  function notify(message, type) {
    if (typeof window.toast === "function") window.toast(message, type || "info");
  }

  function populateCompanyCategorySelect(company) {
    const select = document.getElementById("e-categoria-efetivo");
    if (!select) return;
    const categories = getCategories({ includeInactive: true });
    const editingId = cleanCategoryName(getStore().currentEmpresaEditId);
    const editingCompany = company || (editingId
      ? (Array.isArray(getStore().empresas) ? getStore().empresas : [])
        .find((item) => cleanCategoryName(item?.id) === editingId)
      : null);
    const selectedBeforeRefresh = categories.find((category) => category.id === select.value) || null;
    const current = editingCompany
      ? resolveCategory(editingCompany, { includeInactive: true })
      : selectedBeforeRefresh;
    const allowed = categories.filter((category) => category.ativa || category.id === current?.id);
    select.innerHTML = allowed.map((category) => (
      `<option value="${escapeHtml(category.id)}"${category.ativa ? "" : " data-inactive=\"true\""}>${escapeHtml(category.nome)}${category.ativa ? "" : " (inativa)"}</option>`
    )).join("");
    const fallback = allowed.find((category) => category.nomeNormalizado === "OUTROS") || allowed[0];
    select.value = current?.id || fallback?.id || "";
    select.disabled = !allowed.length;
  }

  function renderCategoryManager() {
    const list = document.getElementById("efetivo-category-list");
    if (!list) return;
    const categories = getCategories({ includeInactive: true });
    const editable = canEdit();
    const configured = getStore().efetivoCategoriasConfiguradas;
    const notice = document.getElementById("efetivo-category-default-notice");
    if (notice) notice.hidden = configured;
    list.innerHTML = categories.map((category, index) => `
      <div class="efetivo-category-row" data-category-id="${escapeHtml(category.id)}">
        <div class="efetivo-category-order">
          <button type="button" class="btn btn-outline btn-sm" data-category-action="up" ${!editable || index === 0 ? "disabled" : ""} aria-label="Subir categoria">↑</button>
          <button type="button" class="btn btn-outline btn-sm" data-category-action="down" ${!editable || index === categories.length - 1 ? "disabled" : ""} aria-label="Descer categoria">↓</button>
        </div>
        <input class="efetivo-category-name" value="${escapeHtml(category.nome)}" ${editable ? "" : "readonly"} aria-label="Nome da categoria">
        <span class="badge-status ${category.ativa ? "conforme" : "irregular"}">${category.ativa ? "Ativa" : "Inativa"}</span>
        <button type="button" class="btn btn-outline btn-sm" data-category-action="rename" ${editable ? "" : "disabled"}>Salvar nome</button>
        <button type="button" class="btn btn-outline btn-sm" data-category-action="toggle" ${editable ? "" : "disabled"}>${category.ativa ? "Inativar" : "Reativar"}</button>
        ${editable ? `<button type="button" class="btn btn-danger btn-sm btn-icon efetivo-category-delete" data-category-action="delete" title="Excluir categoria" aria-label="Excluir categoria">${DELETE_ICON}</button>` : ""}
      </div>
    `).join("");
    list.querySelectorAll("[data-category-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.closest(".efetivo-category-row")?.dataset.categoryId;
        if (!id) return;
        const action = button.dataset.categoryAction;
        if (action === "up") moveCategory(id, -1);
        if (action === "down") moveCategory(id, 1);
        if (action === "rename") renameCategory(id);
        if (action === "toggle") toggleCategory(id);
        if (action === "delete") deleteCategory(id);
      });
    });
    const createControls = document.getElementById("efetivo-category-create");
    if (createControls) createControls.hidden = !editable;
    const initializeButton = document.getElementById("btnInicializarCategoriasEfetivo");
    if (initializeButton) initializeButton.hidden = configured || !editable;
  }

  async function persistCategories(categories, successMessage, options) {
    if (!canEdit()) {
      notify("Seu perfil não pode alterar categorias do efetivo.", "error");
      return false;
    }
    if (typeof window.saveEfetivoCategorias !== "function") {
      notify("Serviço de categorias indisponível.", "error");
      return false;
    }
    const normalized = normalizeCategories(categories).map(({ virtual, legacy, ...category }) => category);
    try {
      await window.saveEfetivoCategorias(normalized);
      applyCategoriesPayload({ exists: true, categorias: normalized });
      notify(successMessage, "success");
      return true;
    } catch (error) {
      console.error("[categorias-efetivo] erro ao salvar", error);
      const permissionDenied = error?.code === "permission-denied"
        || /missing or insufficient permissions/i.test(String(error?.message || ""));
      notify(
        options?.errorMessage
          ? options.errorMessage
          : (permissionDenied
              ? "Você não possui permissão para alterar as categorias desta obra."
              : (error?.message || "Não foi possível salvar as categorias.")),
        "error"
      );
      return false;
    }
  }

  async function initializeDefaults() {
    const now = new Date().toISOString();
    const categories = DEFAULT_CATEGORIES.map(({ virtual, ...category }) => ({
      ...category,
      createdAt: now,
      updatedAt: now,
    }));
    await persistCategories(categories, "Categorias padrão inicializadas.");
  }

  async function createCategory() {
    const input = document.getElementById("efetivo-category-new-name");
    const nome = cleanCategoryName(input?.value);
    try {
      const categories = createCategoryRecord(getCategories({ includeInactive: true }), nome);
      if (await persistCategories(categories, "Categoria criada.")) input.value = "";
    } catch (error) {
      notify(error.message, "error");
    }
  }

  async function renameCategory(id) {
    const row = Array.from(document.querySelectorAll(".efetivo-category-row"))
      .find((item) => item.dataset.categoryId === id);
    const nome = cleanCategoryName(row?.querySelector(".efetivo-category-name")?.value);
    try {
      const next = renameCategoryRecord(getCategories({ includeInactive: true }), id, nome);
      await persistCategories(next, "Categoria renomeada.");
    } catch (error) {
      notify(error.message, "error");
      renderCategoryManager();
    }
  }

  async function toggleCategory(id) {
    const next = toggleCategoryRecord(getCategories({ includeInactive: true }), id);
    await persistCategories(next, next.find((category) => category.id === id)?.ativa ? "Categoria reativada." : "Categoria inativada.");
  }

  async function moveCategory(id, direction) {
    const next = moveCategoryRecord(getCategories({ includeInactive: true }), id, direction);
    await persistCategories(next, "Ordem das categorias atualizada.");
  }

  async function deleteCategory(id) {
    if (!canEdit()) return false;

    const categories = getCategories({ includeInactive: true });
    const category = categories.find((item) => item.id === cleanCategoryName(id));
    if (!category) {
      notify("Categoria não encontrada.", "error");
      return false;
    }

    const companies = Array.isArray(getStore().empresas) ? getStore().empresas : [];
    if (isCategoryLinkedToCompanies(category, companies, categories)) {
      notify(
        "Esta categoria está vinculada a uma ou mais empresas e não pode ser excluída. Inative a categoria caso ela não seja mais utilizada.",
        "error"
      );
      return false;
    }

    if (typeof window.openConfirmModal !== "function") {
      console.error("[categorias-efetivo] modal de confirmação indisponível");
      notify("Não foi possível excluir a categoria.", "error");
      return false;
    }

    const confirmed = await window.openConfirmModal({
      title: "Excluir categoria?",
      message: `A categoria '${category.nome}' será removida permanentemente. Esta ação não poderá ser desfeita.`,
      confirmText: "Excluir categoria",
      cancelText: "Cancelar",
      variant: "danger",
    });
    if (!confirmed) return false;

    // O listener pode receber uma versão mais nova enquanto o modal está aberto.
    // Reaplicar a remoção sobre o estado local mais recente evita persistir a
    // fotografia anterior à confirmação.
    const latestCategories = getCategories({ includeInactive: true });
    const latestCategory = latestCategories.find((item) => item.id === category.id);
    if (!latestCategory) {
      notify("Categoria não encontrada.", "error");
      return false;
    }
    const latestCompanies = Array.isArray(getStore().empresas) ? getStore().empresas : [];
    if (isCategoryLinkedToCompanies(latestCategory, latestCompanies, latestCategories)) {
      notify(
        "Esta categoria está vinculada a uma ou mais empresas e não pode ser excluída. Inative a categoria caso ela não seja mais utilizada.",
        "error"
      );
      return false;
    }

    const next = removeCategoryRecord(latestCategories, latestCategory.id);
    return persistCategories(next, "Categoria excluída com sucesso.", {
      errorMessage: "Não foi possível excluir a categoria.",
    });
  }

  function openManager() {
    renderCategoryManager();
    if (typeof window.openModal === "function") window.openModal("modalEfetivoCategorias");
  }

  window.applyEfetivoCategoriesPayload = applyCategoriesPayload;
  window.getEfetivoCategories = getCategories;
  window.getEfetivoCategoryById = getCategoryById;
  window.resolveEfetivoCategoryForEmpresa = resolveCategory;
  window.populateEmpresaCategoriaSelect = populateCompanyCategorySelect;
  window.formatEmpresaCategoriaEfetivo = (company) => resolveCategory(
    typeof company === "object" ? company : { categoriaEfetivo: company },
    { includeInactive: true }
  )?.nome || "Outros";
  window.openEfetivoCategoriesModal = openManager;
  window.renderEfetivoCategoryManager = renderCategoryManager;
  window.initializeDefaultEfetivoCategories = initializeDefaults;
  window.createEfetivoCategory = createCategory;
  window.renameEfetivoCategory = renameCategory;
  window.toggleEfetivoCategory = toggleCategory;
  window.moveEfetivoCategory = moveCategory;
  window.deleteEfetivoCategory = deleteCategory;
  window.efetivoCategoryUtils = {
    DEFAULT_CATEGORIES,
    cleanCategoryName,
    normalizeCategoryName,
    normalizeCategories,
    createCategoryRecord,
    renameCategoryRecord,
    toggleCategoryRecord,
    moveCategoryRecord,
    companyUsesCategory,
    isCategoryLinkedToCompanies,
    removeCategoryRecord,
    applyCategoriesPayload,
    getCategories,
    getCategoryById,
    resolveCategory,
    deleteCategory,
  };
})();
