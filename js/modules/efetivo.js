(function () {
  "use strict";

  const MONTH_NAMES = [
    "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const MONTH_SHORT = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  const DOW = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];
  const STATUS_LOADING = "Carregando consolidado...";
  const STATUS_EMPTY = "Sem consolidado salvo para o mes.";
  const CATEGORY_ORDER = ["INDIRETOS", "CIVIL", "TERRAPLANAGEM", "ESTRUTURA_METALICA", "INSTALACOES", "OUTROS"];
  const CATEGORY_LABELS = {
    INDIRETOS: "INDIRETOS",
    CIVIL: "CIVIL",
    TERRAPLANAGEM: "TERRAPLANAGEM",
    ESTRUTURA_METALICA: "ESTRUTURA / METALICA",
    INSTALACOES: "INSTALACOES",
    OUTROS: "OUTROS",
  };

  const state = {
    root: null,
    elements: {},
    initialized: false,
    periodoKey: "",
    dataset: null,
    computed: null,
    chart: null,
    unsubscribe: null,
    saveTimer: null,
    isRemoteApplying: false,
    hasRemoteSnapshot: false,
    frequencyData: null,
    frequencyLoaded: false,
    frequencyLoading: false,
    frequencyLoadToken: 0,
    loadStatus: "idle",
    pdfGenerating: false,
  };

  function currentYear() {
    return new Date().getFullYear();
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function getCurrentPeriodoKey() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  }

  function periodoToParts(periodoKey) {
    const match = String(periodoKey || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      const fallback = getCurrentPeriodoKey();
      return periodoToParts(fallback);
    }
    return {
      year: Number(match[1]),
      monthIndex: Number(match[2]) - 1,
      periodoKey: `${match[1]}-${match[2]}`,
    };
  }

  function monthTitle(periodoKey) {
    const parts = periodoToParts(periodoKey);
    return `${MONTH_NAMES[parts.monthIndex]} ${parts.year}`;
  }

  function createMonthDays(year, monthIndex) {
    const count = new Date(year, monthIndex + 1, 0).getDate();
    return Array.from({ length: count }, (_, index) => {
      const day = index + 1;
      const date = new Date(year, monthIndex, day);
      return {
        day,
        month: MONTH_SHORT[monthIndex],
        dow: DOW[date.getDay()],
        iso: `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`,
      };
    });
  }

  function getMonthBounds(periodoKey) {
    const { year, monthIndex } = periodoToParts(periodoKey);
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return {
      first: `${year}-${pad2(monthIndex + 1)}-01`,
      last: `${year}-${pad2(monthIndex + 1)}-${pad2(lastDay)}`,
    };
  }

  function companyDateToIso(value) {
    if (typeof value === "string") {
      const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (
          parsed.getUTCFullYear() === year
          && parsed.getUTCMonth() === month - 1
          && parsed.getUTCDate() === day
        ) {
          return `${match[1]}-${match[2]}-${match[3]}`;
        }
        return "";
      }
    }
    const date = value?.toDate instanceof Function ? value.toDate() : value instanceof Date ? value : null;
    if (!date || Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function cleanText(value) {
    return value == null ? "" : String(value).replace(/\s+/g, " ").trim();
  }

  function removeAccents(value) {
    return cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function normalizeHeader(value) {
    return removeAccents(value)
      .toLowerCase()
      .replace(/[^\w\s/-]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeCompanyIdentityName(value) {
    return removeAccents(value).toLowerCase().replace(/\s+/g, " ").trim();
  }

  function normalizeCategory(value) {
    const normalized = removeAccents(value)
      .toUpperCase()
      .replace(/\s*\/\s*/g, "_")
      .replace(/\s+/g, "_");
    if (normalized === "SERRALHARIA_OUTROS") return "OUTROS";
    if (normalized === "TERRAPLENAGEM") return "TERRAPLANAGEM";
    if (normalized === "ESTRUTURAS_METALICA") return "ESTRUTURA_METALICA";
    return CATEGORY_ORDER.includes(normalized) ? normalized : "OUTROS";
  }

  function categoryLabel(value) {
    return CATEGORY_LABELS[normalizeCategory(value)] || CATEGORY_LABELS.OUTROS;
  }

  function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value == null) return 0;
    const clean = String(value)
      .trim()
      .replace(/\./g, "")
      .replace(",", ".")
      .replace(/[^\d.-]/g, "");
    const number = Number(clean);
    return Number.isFinite(number) ? number : 0;
  }

  function formatInteger(value) {
    return Math.round(toNumber(value)).toLocaleString("pt-BR");
  }

  function formatDecimal(value) {
    return (Math.round(toNumber(value) * 10) / 10).toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }

  function escapeHtml(value) {
    return cleanText(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function notify(message, type) {
    if (typeof window.toast === "function") {
      window.toast(message, type || "info");
      return;
    }
    console.log(`[efetivo] ${message}`);
  }

  function canView() {
    if (typeof window.canViewEfetivo === "function") return window.canViewEfetivo();
    if (typeof window.canViewCurrentObra === "function") return window.canViewCurrentObra();
    return true;
  }

  function canEdit() {
    if (typeof window.canEditEfetivo === "function") return window.canEditEfetivo();
    if (typeof window.canEditFrequencia === "function") return window.canEditFrequencia();
    return false;
  }

  function getObraLabel() {
    if (typeof window.getCurrentObraLabel === "function") {
      return window.getCurrentObraLabel();
    }
    return window.DB?.obra?.nome || "Obra";
  }

  function getObraId() {
    return String(window.APP_CTX?.obraAtivaId || "").trim();
  }

  function getElements(root) {
    const ids = [
      "efetivo-month-select",
      "efetivo-year-input",
      "efetivo-file-input",
      "efetivo-import-button",
      "efetivo-save-button",
      "efetivo-pdf-button",
      "efetivo-refresh-button",
      "efetivo-status",
      "efetivo-source",
      "efetivo-updated-at",
      "efetivo-obra-label",
      "efetivo-kpi-total",
      "efetivo-kpi-total-caption",
      "efetivo-kpi-companies",
      "efetivo-kpi-daily-average",
      "efetivo-kpi-week-caption",
      "efetivo-kpi-month-average",
      "efetivo-weekly-grid",
      "efetivo-month-average-label",
      "efetivo-link-warning",
      "efetivo-chart",
      "efetivo-chart-fallback",
      "efetivo-table",
      "efetivo-empty",
    ];

    return ids.reduce((acc, id) => {
      acc[id] = root.querySelector(`#${id}`);
      return acc;
    }, {});
  }

  function ensurePdfButton(root) {
    const actions = root?.querySelector?.(".efetivo-module__actions");
    if (!actions) return null;
    let button = root.querySelector("#efetivo-pdf-button");
    if (!button) {
      button = document.createElement("button");
      button.className = "efetivo-module__button";
      button.id = "efetivo-pdf-button";
      button.type = "button";
      button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 15h8"/><path d="M8 18h5"/></svg><span>Emitir PDF</span>';
    }
    actions.appendChild(button);
    return button;
  }

  function bindPdfButton() {
    const button = state.elements["efetivo-pdf-button"];
    if (!button || button.dataset.efetivoPdfBound === "1") return;
    button.addEventListener("click", emitPdfReport);
    button.dataset.efetivoPdfBound = "1";
  }

  function bindEvents() {
    const els = state.elements;
    const selectConfiguredPeriod = async () => {
      const month = Number(els["efetivo-month-select"]?.value);
      const year = Number(els["efetivo-year-input"]?.value);
      if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2100) return;
      await selectPeriod(`${year}-${pad2(month)}`);
    };
    els["efetivo-month-select"]?.addEventListener("change", selectConfiguredPeriod);
    els["efetivo-year-input"]?.addEventListener("change", selectConfiguredPeriod);
    els["efetivo-import-button"]?.addEventListener("click", () => {
      if (!canEdit()) {
        notify("Seu perfil pode visualizar, mas nao editar o efetivo.", "error");
        return;
      }
      els["efetivo-file-input"]?.click();
    });
    els["efetivo-file-input"]?.addEventListener("change", handleFileSelect);
    els["efetivo-save-button"]?.addEventListener("click", () => persistDataset("Consolidado salvo."));
    els["efetivo-refresh-button"]?.addEventListener("click", () => subscribeToCurrentPeriod(true));
  }

  function setupMonthSelect() {
    const select = state.elements["efetivo-month-select"];
    if (!select) return;
    const options = Array.from({ length: 12 }, (_, index) => {
      return `<option value="${index + 1}">${MONTH_NAMES[index]}</option>`;
    });
    select.innerHTML = options.join("");
    const yearInput = state.elements["efetivo-year-input"];
    if (yearInput) yearInput.value = String(currentYear());
  }

  function ensurePeriodOption(periodoKey) {
    const select = state.elements["efetivo-month-select"];
    if (!select || !periodoKey) return;
    const parts = periodoToParts(periodoKey);
    select.value = String(parts.monthIndex + 1);
    const yearInput = state.elements["efetivo-year-input"];
    if (yearInput) yearInput.value = String(parts.year);
  }

  function createEmptyDataset(periodoKey) {
    const { year, monthIndex } = periodoToParts(periodoKey);
    const days = createMonthDays(year, monthIndex);
    const empty = {
      obraId: getObraId(),
      project: getObraLabel(),
      source: "Cadastro de empresas",
      updatedAt: "",
      year,
      monthIndex,
      periodoKey,
      days,
      categories: [],
      fileName: "",
    };
    return mergeEligibleCompanies(empty, periodoKey).dataset;
  }

  function normalizeDataset(raw, periodoKey) {
    const parts = periodoToParts(raw?.periodoKey || periodoKey);
    const days = createMonthDays(parts.year, parts.monthIndex);
    const categories = Array.isArray(raw?.categories) ? raw.categories : [];
    const normalizedCategories = categories.map((category) => ({
      ...category,
      name: categoryLabel(category?.name),
      companies: Array.isArray(category?.companies)
        ? category.companies.map((company) => ({
            ...company,
            empresaId: cleanText(company?.empresaId) || null,
            name: cleanText(company?.name || "SEM EMPRESA").toUpperCase(),
            values: normalizeValues(company?.values || [], days.length),
          }))
        : [],
    })).filter((category) => category.companies.length);
    const storedDayHasData = Array.isArray(raw?.dayHasData)
      ? days.map((_, index) => raw.dayHasData[index] === true)
      : null;
    const inferredLegacyDayHasData = days.map((_, dayIndex) => normalizedCategories.some((category) => (
      category.companies.some((company) => toNumber(company.values[dayIndex]) > 0)
    )));

    return {
      ...(raw || {}),
      obraId: raw?.obraId || getObraId(),
      project: raw?.project || getObraLabel(),
      source: raw?.source || "Historico legado",
      updatedAt: raw?.updatedAt || "",
      year: parts.year,
      monthIndex: parts.monthIndex,
      periodoKey: parts.periodoKey,
      days,
      fileName: raw?.fileName || "",
      categories: normalizedCategories,
      dayHasData: storedDayHasData || inferredLegacyDayHasData,
      holidays: raw?.holidays && typeof raw.holidays === "object" ? { ...raw.holidays } : {},
      unresolvedEmployeeDetails: Array.isArray(raw?.unresolvedEmployeeDetails)
        ? raw.unresolvedEmployeeDetails.map((item) => ({ ...item }))
        : [],
      uniquePresentTotals: normalizeValues(raw?.uniquePresentTotals || [], days.length),
    };
  }

  function hasHistoricalSnapshot(dataset) {
    if (!dataset || dataset.derivedFromFrequency) return false;
    if (cleanText(dataset.updatedAt) || cleanText(dataset.fileName)) return true;
    return Array.isArray(dataset.categories) && dataset.categories.some((category) => (
      Array.isArray(category?.companies) && category.companies.some((company) => (
        Array.isArray(company?.values) && company.values.some((value) => toNumber(value) > 0)
      ))
    ));
  }

  function isCompanyEligibleForPeriod(empresa, periodoKey) {
    const bounds = getMonthBounds(periodoKey);
    const start = companyDateToIso(empresa?.dataInicioObra);
    const end = companyDateToIso(empresa?.dataFimObra);
    return (!start || start <= bounds.last) && (!end || end >= bounds.first);
  }

  function isCompanyActiveOnDate(empresa, isoDate) {
    const start = companyDateToIso(empresa?.dataInicioObra);
    const end = companyDateToIso(empresa?.dataFimObra);
    return (!start || start <= isoDate) && (!end || end >= isoDate);
  }

  function getEligibleCompanies(periodoKey, dayCount) {
    const empresas = Array.isArray(window.DB?.empresas) ? window.DB.empresas : [];
    return empresas
      .filter((empresa) => isCompanyEligibleForPeriod(empresa, periodoKey))
      .map((empresa) => {
        const name = cleanText(empresa?.nome).toUpperCase();
        if (!name) return null;
        return {
          empresaId: cleanText(empresa?.id) || null,
          name,
          categoryName: categoryLabel(empresa?.categoriaEfetivo || empresa?.categoria),
          values: new Array(dayCount).fill(0),
        };
      })
      .filter(Boolean);
  }

  function isSameCompany(savedCompany, eligibleCompany) {
    const savedId = cleanText(savedCompany?.empresaId);
    const eligibleId = cleanText(eligibleCompany?.empresaId);
    if (savedId && eligibleId) return savedId === eligibleId;
    const savedName = normalizeCompanyIdentityName(savedCompany?.name);
    const eligibleName = normalizeCompanyIdentityName(eligibleCompany?.name);
    return Boolean(savedName && eligibleName && savedName === eligibleName);
  }

  function mergeEligibleCompanies(dataset, periodoKey) {
    const key = periodoToParts(periodoKey || dataset?.periodoKey).periodoKey;
    const dayCount = Array.isArray(dataset?.days)
      ? dataset.days.length
      : createMonthDays(periodoToParts(key).year, periodoToParts(key).monthIndex).length;
    const categories = (Array.isArray(dataset?.categories) ? dataset.categories : []).map((category) => ({
      ...category,
      companies: (Array.isArray(category?.companies) ? category.companies : []).map((company) => ({
        ...company,
        values: Array.isArray(company?.values) ? company.values.slice() : new Array(dayCount).fill(0),
      })),
    }));
    let added = 0;
    let identityLinked = 0;

    getEligibleCompanies(key, dayCount).forEach((eligibleCompany) => {
      const matches = categories.flatMap((category) => (
        category.companies.filter((company) => isSameCompany(company, eligibleCompany))
      ));
      if (matches.length === 1) {
        if (!cleanText(matches[0].empresaId) && cleanText(eligibleCompany.empresaId)) {
          matches[0].empresaId = eligibleCompany.empresaId;
          identityLinked += 1;
        }
        return;
      }
      if (matches.length > 1) return;

      let category = categories.find((item) => (
        normalizeCompanyIdentityName(item.name) === normalizeCompanyIdentityName(eligibleCompany.categoryName)
      ));
      if (!category) {
        category = { name: eligibleCompany.categoryName || "OUTROS", companies: [] };
        categories.push(category);
      }
      category.companies.push({
        empresaId: eligibleCompany.empresaId,
        name: eligibleCompany.name,
        values: eligibleCompany.values,
      });
      added += 1;
    });

    return {
      dataset: { ...dataset, categories },
      added,
      identityLinked,
    };
  }

  function resolveEmployeeCompany(funcionario, empresas) {
    const companyId = cleanText(funcionario?.empresaId);
    if (companyId) {
      return empresas.find((empresa) => cleanText(empresa?.id) === companyId) || null;
    }

    const legacyName = normalizeCompanyIdentityName(funcionario?.empresa);
    if (!legacyName) return null;
    const matches = empresas.filter((empresa) => normalizeCompanyIdentityName(empresa?.nome) === legacyName);
    return matches.length === 1 ? matches[0] : null;
  }

  function frequencyStatus(value) {
    if (Array.isArray(value)) {
      return value.some((entry) => frequencyStatus(entry) === "Trabalhado") ? "Trabalhado" : "";
    }
    if (typeof value === "string") return value;
    if (value && typeof value === "object") return cleanText(value.status);
    return "";
  }

  function isPresenceValue(value) {
    return frequencyStatus(value) === "Trabalhado";
  }

  function getDaysWithData(frequencyData, days) {
    const holidays = frequencyData?.feriados && typeof frequencyData.feriados === "object"
      ? frequencyData.feriados
      : {};
    const buckets = [frequencyData?.terceirizados, frequencyData?.novoAtacarejo]
      .filter((bucket) => bucket && typeof bucket === "object");

    return days.map((day) => {
      const dayKey = String(day.day);
      if (Object.prototype.hasOwnProperty.call(holidays, dayKey)) return true;
      return buckets.some((bucket) => Object.values(bucket).some((cells) => (
        cells && typeof cells === "object"
        && Object.prototype.hasOwnProperty.call(cells, dayKey)
        && cells[dayKey] !== null
        && cells[dayKey] !== undefined
      )));
    });
  }

  function consolidateFrequency(periodoKey, frequencyData) {
    const parts = periodoToParts(periodoKey);
    const days = createMonthDays(parts.year, parts.monthIndex);
    const empresas = Array.isArray(window.DB?.empresas) ? window.DB.empresas : [];
    const funcionarios = Array.isArray(window.DB?.funcionarios) ? window.DB.funcionarios : [];
    const eligibleCompanies = empresas.filter((empresa) => isCompanyEligibleForPeriod(empresa, periodoKey));
    const valuesByCompany = new Map(eligibleCompanies.map((empresa) => [cleanText(empresa.id), new Array(days.length).fill(0)]));
    const counted = new Set();
    const uniquePresentByDay = days.map(() => new Set());
    const unresolvedEmployees = [];

    funcionarios.forEach((funcionario) => {
      const employeeId = cleanText(funcionario?.id);
      if (!employeeId) return;
      const bucketName = funcionario.tipo === "Terceirizado" ? "terceirizados" : "novoAtacarejo";
      const cells = frequencyData?.[bucketName]?.[employeeId] || {};
      const presentDays = days.filter((day, dayIndex) => {
        if (!isPresenceValue(cells[String(day.day)])) return false;
        uniquePresentByDay[dayIndex].add(employeeId);
        return true;
      });
      const empresa = resolveEmployeeCompany(funcionario, empresas);
      if (!empresa || !valuesByCompany.has(cleanText(empresa.id))) {
        if (presentDays.length) {
          unresolvedEmployees.push({
            id: employeeId,
            nome: cleanText(funcionario?.nome) || employeeId,
            empresa: cleanText(funcionario?.empresa),
            tipo: cleanText(funcionario?.tipo),
            dias: presentDays.map((day) => day.day),
          });
        }
        return;
      }

      const companyValues = valuesByCompany.get(cleanText(empresa.id));
      days.forEach((day, dayIndex) => {
        if (!isCompanyActiveOnDate(empresa, day.iso) || !isPresenceValue(cells[String(day.day)])) return;
        const uniqueKey = `${day.iso}|${employeeId}`;
        if (counted.has(uniqueKey)) return;
        counted.add(uniqueKey);
        companyValues[dayIndex] += 1;
      });
    });

    const categories = new Map();
    eligibleCompanies.forEach((empresa) => {
      const category = normalizeCategory(empresa?.categoriaEfetivo || empresa?.categoria);
      if (!categories.has(category)) categories.set(category, []);
      categories.get(category).push({
        empresaId: cleanText(empresa.id) || null,
        name: cleanText(empresa.nome || "SEM EMPRESA").toUpperCase(),
        values: valuesByCompany.get(cleanText(empresa.id)) || new Array(days.length).fill(0),
      });
    });

    return {
      categories: CATEGORY_ORDER
        .filter((category) => categories.has(category))
        .map((category) => ({
          name: CATEGORY_LABELS[category],
          companies: categories.get(category).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
        })),
      dayHasData: getDaysWithData(frequencyData, days),
      holidays: frequencyData?.feriados && typeof frequencyData.feriados === "object"
        ? { ...frequencyData.feriados }
        : {},
      unresolvedEmployees,
      uniquePresentTotals: uniquePresentByDay.map((employees) => employees.size),
    };
  }

  function applyFrequencyToDataset(dataset, periodoKey, frequencyData) {
    const consolidated = consolidateFrequency(periodoKey, frequencyData || {});
    return normalizeDataset({
      ...(dataset || {}),
      source: "Frequência",
      updatedAt: new Date().toLocaleString("pt-BR"),
      periodoKey,
      categories: consolidated.categories,
      dayHasData: consolidated.dayHasData,
      holidays: consolidated.holidays,
      unresolvedEmployeeDetails: consolidated.unresolvedEmployees,
      uniquePresentTotals: consolidated.uniquePresentTotals,
      derivedFromFrequency: true,
    }, periodoKey);
  }

  function normalizeValues(values, length) {
    const output = new Array(length).fill(0);
    values.slice(0, length).forEach((value, index) => {
      output[index] = Math.max(0, Math.round(toNumber(value)));
    });
    return output;
  }

  function sum(values) {
    return values.reduce((total, value) => total + toNumber(value), 0);
  }

  function sumArrays(arrays, length) {
    const result = new Array(length).fill(0);
    arrays.forEach((values) => {
      for (let i = 0; i < length; i += 1) {
        result[i] += toNumber(values[i]);
      }
    });
    return result;
  }

  function averageDaily(values) {
    return values.length ? sum(values) / values.length : 0;
  }

  function averageForDataDays(values, dayHasData) {
    const validValues = values.filter((_, index) => dayHasData[index] === true);
    return validValues.length ? averageDaily(validValues) : null;
  }

  function weeklyAverages(values, dayHasData) {
    const weeks = [];
    for (let index = 0; index < values.length; index += 7) {
      const endIndex = Math.min(index + 7, values.length);
      const weekValues = values.slice(index, endIndex);
      const weekMask = dayHasData.slice(index, endIndex);
      weeks.push({
        startDay: index + 1,
        endDay: endIndex,
        average: averageForDataDays(weekValues, weekMask),
        daysWithData: weekMask.filter(Boolean).length,
      });
    }
    return weeks;
  }

  function getLastDayWithData(dayHasData) {
    for (let index = dayHasData.length - 1; index >= 0; index -= 1) {
      if (dayHasData[index] === true) return index;
    }
    return -1;
  }

  function validateConsistency(categories, dailyTotals, uniquePresentTotals, dayHasData, periodoKey, validateUniqueTotals) {
    categories.forEach((category) => {
      category.totals.forEach((subtotal, dayIndex) => {
        const companySum = category.companies.reduce((total, company) => total + toNumber(company.values[dayIndex]), 0);
        if (companySum !== subtotal) {
          console.warn("[efetivo] subtotal divergente", { periodoKey, categoria: category.name, dia: dayIndex + 1, companySum, subtotal });
        }
      });
    });

    dailyTotals.forEach((total, dayIndex) => {
      const subtotalSum = categories.reduce((acc, category) => acc + toNumber(category.totals[dayIndex]), 0);
      if (subtotalSum !== total) {
        console.warn("[efetivo] total geral divergente dos subtotais", { periodoKey, dia: dayIndex + 1, subtotalSum, total });
      }
      if (validateUniqueTotals && dayHasData[dayIndex] && uniquePresentTotals[dayIndex] !== total) {
        console.warn("[efetivo] presentes unicos divergem do total por empresas", {
          periodoKey,
          dia: dayIndex + 1,
          presentesUnicos: uniquePresentTotals[dayIndex],
          totalEmpresas: total,
        });
      }
    });
  }

  function computeDataset(dataset) {
    const dayCount = dataset.days.length;
    const dayHasData = Array.isArray(dataset.dayHasData)
      ? dataset.days.map((_, index) => dataset.dayHasData[index] === true)
      : new Array(dayCount).fill(false);
    const categories = dataset.categories.map((category) => {
      const companies = category.companies.map((company) => ({
        ...company,
        name: company.name,
        values: normalizeValues(company.values, dayCount),
        average: averageForDataDays(normalizeValues(company.values, dayCount), dayHasData),
      }));
      const totals = sumArrays(companies.map((company) => company.values), dayCount);
      return { ...category, name: category.name, companies, totals, average: averageForDataDays(totals, dayHasData) };
    });
    const dailyTotals = sumArrays(categories.map((category) => category.totals), dayCount);
    const activeCompanies = categories.reduce((acc, category) => acc + category.companies.length, 0);
    const weekly = weeklyAverages(dailyTotals, dayHasData);
    const lastDayIndex = getLastDayWithData(dayHasData);
    const latestWeek = [...weekly].reverse().find((week) => week.average !== null) || null;
    const uniquePresentTotals = normalizeValues(dataset.uniquePresentTotals || [], dayCount);

    validateConsistency(categories, dailyTotals, uniquePresentTotals, dayHasData, dataset.periodoKey, dataset.derivedFromFrequency === true);

    return {
      dataset,
      categories,
      dailyTotals,
      dayHasData,
      activeCompanies,
      effectiveTotal: lastDayIndex >= 0 ? dailyTotals[lastDayIndex] : null,
      effectiveDay: lastDayIndex >= 0 ? dataset.days[lastDayIndex] : null,
      weeklyAverage: latestWeek?.average ?? null,
      latestWeek,
      monthAverage: averageForDataDays(dailyTotals, dayHasData),
      weeklyAverages: weekly,
    };
  }

  function render() {
    if (!state.root) return;
    if (!canView()) {
      renderNoAccess();
      return;
    }

    const dataset = state.dataset || createEmptyDataset(state.periodoKey || getCurrentPeriodoKey());
    state.dataset = normalizeDataset(dataset, state.periodoKey || dataset.periodoKey);
    state.computed = computeDataset(state.dataset);

    renderHeader();
    renderKpis();
    renderWeeklyAverages();
    renderLinkWarning();
    renderTable();
    renderChart();
    syncPermissions();
  }

  function renderNoAccess() {
    const els = state.elements;
    destroyChart();
    if (els["efetivo-empty"]) {
      els["efetivo-empty"].hidden = false;
      els["efetivo-empty"].textContent = "Voce nao possui acesso a obra ativa.";
    }
    if (els["efetivo-table"]) els["efetivo-table"].innerHTML = "";
  }

  function renderHeader() {
    const els = state.elements;
    const dataset = state.dataset;
    if (els["efetivo-obra-label"]) els["efetivo-obra-label"].textContent = getObraLabel();
    if (els["efetivo-source"]) els["efetivo-source"].textContent = dataset.derivedFromFrequency
      ? "Frequência"
      : "Histórico consolidado";
    if (els["efetivo-updated-at"]) els["efetivo-updated-at"].textContent = dataset.updatedAt || "--";
    if (els["efetivo-status"] && !els["efetivo-status"].dataset.busy) {
      const labels = {
        loading: "Carregando dados da competencia...",
        real: "Dados reais consolidados da frequencia.",
        legacy: "Sem frequencia salva; exibindo historico consolidado.",
        empty: "Sem dados de frequencia para a competencia.",
        error: "Erro ao carregar os dados da competencia.",
      };
      els["efetivo-status"].textContent = labels[state.loadStatus]
        || (dataset.updatedAt ? "Consolidado carregado." : STATUS_EMPTY);
    }
  }

  function renderKpis() {
    const computed = state.computed;
    state.elements["efetivo-kpi-total"].textContent = computed.effectiveTotal === null ? "—" : formatInteger(computed.effectiveTotal);
    state.elements["efetivo-kpi-companies"].textContent = formatInteger(computed.activeCompanies);
    state.elements["efetivo-kpi-daily-average"].textContent = computed.weeklyAverage === null ? "—" : formatDecimal(computed.weeklyAverage);
    state.elements["efetivo-kpi-month-average"].textContent = computed.monthAverage === null ? "—" : formatDecimal(computed.monthAverage);
    if (state.elements["efetivo-kpi-total-caption"]) {
      state.elements["efetivo-kpi-total-caption"].textContent = computed.effectiveDay
        ? `Dia ${pad2(computed.effectiveDay.day)} · colaboradores`
        : "Sem dia consolidado";
    }
    if (state.elements["efetivo-kpi-week-caption"]) {
      state.elements["efetivo-kpi-week-caption"].textContent = computed.latestWeek
        ? `Dias ${pad2(computed.latestWeek.startDay)}–${pad2(computed.latestWeek.endDay)}`
        : "Sem semana consolidada";
    }
  }

  function renderWeeklyAverages() {
    const grid = state.elements["efetivo-weekly-grid"];
    const monthLabel = state.elements["efetivo-month-average-label"];
    if (!grid) return;
    grid.innerHTML = state.computed.weeklyAverages.map((week, index) => `
      <article class="efetivo-module__week-card">
        <span>Semana ${index + 1}</span>
        <small>${pad2(week.startDay)}–${pad2(week.endDay)}</small>
        <strong>${week.average === null ? "—" : formatDecimal(week.average)}</strong>
        <em>${week.daysWithData ? `${week.daysWithData} dia(s) com dados` : "Sem dados"}</em>
      </article>
    `).join("");
    if (monthLabel) {
      monthLabel.textContent = `Média do mês: ${state.computed.monthAverage === null ? "—" : formatDecimal(state.computed.monthAverage)}`;
    }
  }

  function renderLinkWarning() {
    const warning = state.elements["efetivo-link-warning"];
    if (!warning) return;
    const unresolved = state.dataset.unresolvedEmployeeDetails || [];
    if (!unresolved.length) {
      warning.hidden = true;
      warning.innerHTML = "";
      return;
    }
    warning.hidden = false;
    warning.innerHTML = `<strong>${unresolved.length} colaborador(es) presente(s) possuem vinculo de empresa nao resolvido.</strong>
      <details><summary>Ver colaboradores</summary><ul>${unresolved.map((item) => (
        `<li>${escapeHtml(item.nome)}${item.empresa ? ` · ${escapeHtml(item.empresa)}` : ""} · dias ${item.dias.map(pad2).join(", ")}</li>`
      )).join("")}</ul></details>`;
  }

  function renderTable() {
    const table = state.elements["efetivo-table"];
    const empty = state.elements["efetivo-empty"];
    const computed = state.computed;

    const stateMessages = {
      loading: "Carregando empresas, frequencia e consolidacao...",
      empty: "Nao existem lancamentos de frequencia para esta competencia.",
      error: "Nao foi possivel carregar os dados desta competencia.",
    };
    if (stateMessages[state.loadStatus]) {
      table.innerHTML = "";
      if (empty) {
        empty.hidden = false;
        empty.textContent = stateMessages[state.loadStatus];
      }
      return;
    }

    if (!computed.categories.length) {
      table.innerHTML = "";
      if (empty) {
        empty.hidden = false;
        empty.textContent = "Nenhuma empresa valida foi encontrada para esta competencia.";
      }
      return;
    }

    if (empty) empty.hidden = true;

    const headers = [
      '<th class="efetivo-module__company-head">Empresa</th>',
      ...computed.dataset.days.map((day, dayIndex) => {
        const classes = getDayClasses(day, dayIndex, computed);
        const holiday = computed.dataset.holidays?.[String(day.day)];
        return `<th class="efetivo-module__day-head ${classes}"${holiday !== undefined ? ` title="${escapeHtml(holiday || "Feriado")}"` : ""}><span>${escapeHtml(day.month)}</span><b>${pad2(day.day)}</b><small>${escapeHtml(day.dow)}</small></th>`;
      }),
      '<th class="efetivo-module__average-head">Média</th>',
    ];

    const rows = [];
    computed.categories.forEach((category, categoryIndex) => {
      rows.push(`<tr class="efetivo-module__category-row"><td colspan="${computed.dataset.days.length + 2}">${escapeHtml(category.name)}</td></tr>`);
      category.companies.forEach((company) => {
        rows.push(`<tr>
          <td class="efetivo-module__company-cell">${escapeHtml(company.name)}</td>
          ${company.values.map((value, dayIndex) => renderValueCell(value, dayIndex, computed)).join("")}
          <td class="efetivo-module__average-cell">${company.average === null ? "—" : formatDecimal(company.average)}</td>
        </tr>`);
      });
      rows.push(`<tr class="efetivo-module__category-total">
        <td>Total ${escapeHtml(category.name)}</td>
        ${category.totals.map((value, dayIndex) => renderSummaryCell(value, dayIndex, computed)).join("")}
        <td class="efetivo-module__average-cell">${category.average === null ? "—" : formatDecimal(category.average)}</td>
      </tr>`);
    });

    rows.push(`<tr class="efetivo-module__grand-total">
      <td>Total geral da obra</td>
      ${computed.dailyTotals.map((value, dayIndex) => renderSummaryCell(value, dayIndex, computed)).join("")}
      <td class="efetivo-module__average-cell">${computed.monthAverage === null ? "—" : formatDecimal(computed.monthAverage)}</td>
    </tr>`);

    table.innerHTML = `<thead><tr>${headers.join("")}</tr></thead><tbody>${rows.join("")}</tbody>`;
  }

  function isCurrentDay(day) {
    const now = new Date();
    return state.dataset?.year === now.getFullYear()
      && state.dataset?.monthIndex === now.getMonth()
      && day.day === now.getDate();
  }

  function getDayClasses(day, dayIndex, computed) {
    const classes = [];
    if (day.dow === "SAB" || day.dow === "DOM") classes.push("is-weekend");
    if (isCurrentDay(day)) classes.push("is-current-day");
    if (Object.prototype.hasOwnProperty.call(computed.dataset.holidays || {}, String(day.day))) classes.push("is-holiday");
    if (!computed.dayHasData[dayIndex]) classes.push("is-no-data");
    return classes.join(" ");
  }

  function renderValueCell(value, dayIndex, computed) {
    const numeric = Math.max(0, Math.round(toNumber(value)));
    const day = computed.dataset.days[dayIndex];
    const classes = getDayClasses(day, dayIndex, computed);
    if (!computed.dayHasData[dayIndex]) return `<td class="${classes} efetivo-module__no-data">—</td>`;
    return `<td class="${classes} ${numeric ? "" : "efetivo-module__zero"}">${formatInteger(numeric)}</td>`;
  }

  function renderSummaryCell(value, dayIndex, computed) {
    const day = computed.dataset.days[dayIndex];
    const classes = getDayClasses(day, dayIndex, computed);
    return `<td class="${classes}${computed.dayHasData[dayIndex] ? "" : " efetivo-module__no-data"}">${computed.dayHasData[dayIndex] ? formatInteger(value) : "—"}</td>`;
  }

  function renderChart() {
    const canvas = state.elements["efetivo-chart"];
    const fallback = state.elements["efetivo-chart-fallback"];
    const computed = state.computed;
    if (!canvas || !computed) return;

    const hasChartData = (state.loadStatus === "real" || state.loadStatus === "legacy")
      && computed.dayHasData.some(Boolean);
    if (!hasChartData) {
      destroyChart();
      canvas.hidden = true;
      if (fallback) {
        fallback.hidden = false;
        fallback.innerHTML = '<div class="efetivo-module__chart-empty">Sem dados diarios para exibir.</div>';
      }
      return;
    }

    if (!window.Chart) {
      destroyChart();
      if (fallback) {
        fallback.hidden = false;
        fallback.innerHTML = renderSvgChart(computed);
      }
      canvas.hidden = true;
      return;
    }

    if (fallback) {
      fallback.hidden = true;
      fallback.innerHTML = "";
    }
    canvas.hidden = false;
    destroyChart();

    const labels = computed.dataset.days.map((day) => pad2(day.day));
    const data = computed.dailyTotals.map((value, index) => (
      computed.dayHasData[index] ? Math.round(toNumber(value) * 10) / 10 : null
    ));
    const numericData = data.filter((value) => value !== null);
    const max = Math.max(10, Math.ceil(Math.max(...numericData, 0) / 10) * 10 + 10);

    state.chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Efetivo diario",
          data,
          borderColor: "#f47a2a",
          backgroundColor: "rgba(244, 122, 42, 0.11)",
          pointBackgroundColor: "#ffffff",
          pointBorderColor: "#f47a2a",
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.28,
          fill: false,
          spanGaps: false,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1f2024",
            borderColor: "#f47a2a",
            borderWidth: 1,
            displayColors: false,
            titleColor: "#ffffff",
            bodyColor: "#ffffff",
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: "#687180", font: { weight: 800 } },
          },
          y: {
            beginAtZero: true,
            suggestedMax: max,
            grid: { color: "#d8dde4" },
            ticks: { color: "#687180", precision: 0 },
          },
        },
      },
    });
  }

  function renderSvgChart(computed) {
    const values = computed.dailyTotals.map((value, index) => (
      computed.dayHasData[index] ? Math.round(toNumber(value)) : null
    ));
    const width = 900;
    const height = 260;
    const left = 42;
    const right = 18;
    const top = 18;
    const bottom = 38;
    const validValues = values.filter((value) => value !== null);
    const max = Math.max(10, Math.ceil(Math.max(...validValues, 0) / 10) * 10);
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const dayCount = Math.max(1, values.length - 1);
    const segments = [];
    let currentSegment = [];
    values.forEach((value, index) => {
      if (value === null) {
        if (currentSegment.length) segments.push(currentSegment);
        currentSegment = [];
        return;
      }
      const x = left + (plotWidth * index / dayCount);
      const y = top + plotHeight - (plotHeight * value / max);
      currentSegment.push(`${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`);
    });
    if (currentSegment.length) segments.push(currentSegment);

    const labels = computed.dataset.days.map((day, index) => {
      if (index !== 0 && index !== computed.dataset.days.length - 1 && (index + 1) % 5 !== 0) return "";
      const x = left + (plotWidth * index / dayCount);
      return `<text x="${x}" y="${height - 12}" text-anchor="middle" font-size="11" font-weight="800" fill="#687180">${pad2(day.day)}</text>`;
    }).join("");

    return `<svg class="efetivo-module__svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolucao mensal do efetivo">
      <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#ffffff"/>
      <line x1="${left}" y1="${top + plotHeight}" x2="${width - right}" y2="${top + plotHeight}" stroke="#d8dde4"/>
      ${segments.map((points) => `<polyline points="${points.join(" ")}" fill="none" stroke="#f47a2a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`).join("")}
      ${labels}
    </svg>`;
  }

  function destroyChart() {
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
  }

  function setStatus(message, busy) {
    const status = state.elements["efetivo-status"];
    if (!status) return;
    status.textContent = message;
    if (busy) status.dataset.busy = "1";
    else delete status.dataset.busy;
  }

  async function selectPeriod(periodoKey) {
    const key = periodoToParts(periodoKey).periodoKey;
    if (key !== state.periodoKey && state.saveTimer) {
      const select = state.elements["efetivo-month-select"];
      window.clearTimeout(state.saveTimer);
      state.saveTimer = null;
      if (select) select.disabled = true;
      try {
        await persistDataset("Alteracoes salvas.");
      } finally {
        if (select) select.disabled = false;
      }
    }
    state.periodoKey = key;
    state.hasRemoteSnapshot = false;
    state.frequencyData = null;
    state.frequencyLoaded = false;
    state.frequencyLoading = false;
    state.loadStatus = "loading";
    ensurePeriodOption(key);
    state.dataset = createEmptyDataset(key);
    render();
    subscribeToCurrentPeriod();
  }

  async function loadFrequencyForPeriod(periodoKey, baseDataset) {
    const token = ++state.frequencyLoadToken;
    state.frequencyLoading = true;
    if (typeof window.getFrequencia !== "function") {
      state.frequencyData = null;
      state.frequencyLoaded = true;
      state.frequencyLoading = false;
      state.dataset = baseDataset;
      state.loadStatus = hasHistoricalSnapshot(baseDataset) ? "legacy" : "empty";
      render();
      return;
    }

    try {
      const payload = await window.getFrequencia(periodoKey);
      if (token !== state.frequencyLoadToken || state.periodoKey !== periodoKey) return;
      state.frequencyData = payload?.data || null;
      state.frequencyLoaded = true;
      state.frequencyLoading = false;
      state.dataset = payload?.data
        ? applyFrequencyToDataset(baseDataset, periodoKey, payload.data)
        : baseDataset;
      state.loadStatus = payload?.data
        ? (state.dataset.dayHasData.some(Boolean) ? "real" : "empty")
        : (hasHistoricalSnapshot(baseDataset) ? "legacy" : "empty");
      setStatus(payload?.data
        ? "Frequencia carregada e consolidada."
        : (baseDataset?.updatedAt ? "Sem frequencia salva; exibindo historico legado." : STATUS_EMPTY), false);
      render();
    } catch (error) {
      if (token !== state.frequencyLoadToken || state.periodoKey !== periodoKey) return;
      console.error("[efetivo] erro ao carregar frequencia", error);
      state.frequencyData = null;
      state.frequencyLoaded = true;
      state.frequencyLoading = false;
      state.dataset = baseDataset;
      state.loadStatus = hasHistoricalSnapshot(baseDataset) ? "legacy" : "error";
      setStatus("Falha ao carregar frequencia; exibindo consolidado historico disponivel.", false);
      render();
    }
  }

  function subscribeToCurrentPeriod(forceFrequencyReload) {
    if (typeof state.unsubscribe === "function") {
      state.unsubscribe();
      state.unsubscribe = null;
    }

    if (!canView()) {
      renderNoAccess();
      return;
    }

    if (typeof window.listenEfetivo !== "function") {
      state.loadStatus = "error";
      setStatus("Servico de efetivo indisponivel.", false);
      render();
      return;
    }

    setStatus(STATUS_LOADING, true);
    state.loadStatus = "loading";
    state.hasRemoteSnapshot = false;
    if (forceFrequencyReload) {
      state.frequencyData = null;
      state.frequencyLoaded = false;
      state.frequencyLoading = false;
    }
    render();
    const subscribedPeriod = state.periodoKey;
    state.unsubscribe = window.listenEfetivo(subscribedPeriod, (payload) => {
      if (state.periodoKey !== subscribedPeriod) return;
      state.isRemoteApplying = true;
      const hasSavedDataset = Boolean(payload?.data);
      const incoming = hasSavedDataset
        ? normalizeDataset(payload.data, state.periodoKey)
        : createEmptyDataset(state.periodoKey);
      const merged = hasSavedDataset
        ? mergeEligibleCompanies(incoming, state.periodoKey)
        : { dataset: incoming, added: 0 };
      const baseDataset = merged.dataset;
      state.dataset = state.frequencyLoaded && state.frequencyData
        ? applyFrequencyToDataset(baseDataset, state.periodoKey, state.frequencyData)
        : baseDataset;
      state.loadStatus = state.frequencyLoaded
        ? (state.frequencyData
          ? (state.dataset.dayHasData.some(Boolean) ? "real" : "empty")
          : (hasHistoricalSnapshot(baseDataset) ? "legacy" : "empty"))
        : "loading";
      state.hasRemoteSnapshot = true;
      setStatus(payload?.data ? "Consolidado carregado do Firebase." : STATUS_EMPTY, false);
      render();
      state.isRemoteApplying = false;
      if (!state.frequencyLoaded && !state.frequencyLoading) {
        loadFrequencyForPeriod(subscribedPeriod, baseDataset);
      }
    });
  }

  function syncPermissions() {
    const editable = canEdit();
    const importControls = [state.elements["efetivo-import-button"], state.elements["efetivo-file-input"]];
    importControls.forEach((control) => {
      if (!control) return;
      control.disabled = !editable;
      control.style.pointerEvents = editable ? "" : "none";
      control.style.opacity = editable ? "" : "0.55";
    });
    const saveButton = state.elements["efetivo-save-button"];
    if (saveButton) {
      const canSaveConsolidation = editable
        && state.loadStatus === "real"
        && state.dataset?.derivedFromFrequency === true;
      saveButton.disabled = !canSaveConsolidation;
      saveButton.style.pointerEvents = canSaveConsolidation ? "" : "none";
      saveButton.style.opacity = canSaveConsolidation ? "" : "0.55";
      saveButton.title = canSaveConsolidation ? "Salvar snapshot derivado da frequencia" : "Disponivel apos carregar a frequencia";
    }
    const pdfButton = state.elements["efetivo-pdf-button"];
    if (pdfButton) {
      const hasReportData = (state.loadStatus === "real" || state.loadStatus === "legacy")
        && state.computed?.dayHasData?.some(Boolean);
      const canEmitPdf = canView() && hasReportData && !state.pdfGenerating;
      pdfButton.disabled = !canEmitPdf;
      pdfButton.style.pointerEvents = canEmitPdf ? "" : "none";
      pdfButton.style.opacity = canEmitPdf ? "" : "0.55";
      const label = pdfButton.querySelector("span");
      if (label) label.textContent = state.pdfGenerating ? "Gerando PDF..." : "Emitir PDF";
      pdfButton.title = hasReportData ? "Emitir relatório da competência selecionada" : "Não há dados para emitir nesta competência";
    }
  }

  function handleTableInput(event) {
    const input = event.target;
    if (!input?.classList?.contains("efetivo-module__daily-input")) return;
    if (!canEdit()) return;
    applyInputValue(input);
    renderHeader();
    renderKpis();
    renderChart();
    scheduleSave();
  }

  function handleTableCommit(event) {
    const input = event.target;
    if (!input?.classList?.contains("efetivo-module__daily-input")) return;
    if (!canEdit()) return;
    applyInputValue(input, true);
    render();
    scheduleSave(100);
  }

  function applyInputValue(input, normalizeInput) {
    const categoryIndex = Number(input.dataset.efetivoCategoryIndex);
    const companyIndex = Number(input.dataset.efetivoCompanyIndex);
    const dayIndex = Number(input.dataset.efetivoDayIndex);
    const company = state.dataset?.categories?.[categoryIndex]?.companies?.[companyIndex];
    if (!company) return;
    const value = Math.max(0, Math.round(toNumber(input.value)));
    company.values[dayIndex] = value;
    state.dataset.updatedAt = new Date().toLocaleString("pt-BR");
    if (normalizeInput) input.value = String(value);
    state.computed = computeDataset(state.dataset);
  }

  function scheduleSave(delay) {
    if (state.isRemoteApplying || !canEdit()) return;
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(() => {
      state.saveTimer = null;
      persistDataset("Alteracoes salvas.");
    }, delay ?? 900);
  }

  async function persistDataset(successMessage, allowHistoricalImport) {
    if (!canEdit()) {
      notify("Seu perfil nao pode salvar o efetivo.", "error");
      return;
    }
    if (!state.dataset) return;
    if (!state.dataset.derivedFromFrequency && !allowHistoricalImport) {
      notify("A consolidacao so pode ser salva depois de derivada da frequencia.", "error");
      return;
    }
    if (typeof window.saveEfetivo !== "function") {
      notify("Servico de efetivo indisponivel.", "error");
      return;
    }

    const merged = mergeEligibleCompanies(state.dataset, state.periodoKey);
    const dataset = normalizeDataset({
      ...merged.dataset,
      obraId: getObraId(),
      project: getObraLabel(),
      updatedAt: new Date().toLocaleString("pt-BR"),
    }, state.periodoKey);

    try {
      setStatus("Salvando consolidado...", true);
      await window.saveEfetivo(state.periodoKey, dataset);
      if (typeof window.saveEfetivoCategorias === "function") {
        await window.saveEfetivoCategorias(dataset.categories.map((category) => category.name));
      }
      state.dataset = dataset;
      setStatus(successMessage || "Consolidado salvo.", false);
      render();
    } catch (error) {
      console.error("[efetivo] erro ao salvar", error);
      setStatus("Erro ao salvar consolidado.", false);
      notify(error?.message || "Erro ao salvar efetivo.", "error");
    }
  }

  async function handleFileSelect(event) {
    const file = event.target?.files?.[0];
    if (!file) return;
    try {
      setStatus("Importando arquivo...", true);
      const dataset = await parseFile(file);
      state.periodoKey = dataset.periodoKey;
      ensurePeriodOption(state.periodoKey);
      state.dataset = normalizeDataset(dataset, state.periodoKey);
      render();
      await persistDataset("Arquivo importado e salvo.", true);
      if (typeof window.saveEfetivoImportacao === "function") {
        await window.saveEfetivoImportacao({
          periodoKey: state.periodoKey,
          fileName: file.name,
          source: state.dataset.source,
          categories: state.dataset.categories.length,
          companies: state.dataset.categories.reduce((acc, category) => acc + category.companies.length, 0),
          importedAt: new Date().toISOString(),
        });
      }
      subscribeToCurrentPeriod();
      notify("Arquivo importado com sucesso.", "success");
    } catch (error) {
      console.error("[efetivo] erro ao importar", error);
      setStatus("Erro ao importar arquivo.", false);
      notify(error?.message || "Nao foi possivel importar o arquivo.", "error");
    } finally {
      event.target.value = "";
    }
  }

  async function parseFile(file) {
    const extension = file.name.split(".").pop().toLowerCase();
    if (extension === "xlsx" || extension === "xls") return parseWorkbook(file);
    if (extension === "csv") return parseCsvFile(file);
    throw new Error("Formato nao suportado. Use CSV, XLSX ou XLS.");
  }

  async function parseWorkbook(file) {
    if (!window.XLSX) throw new Error("Biblioteca XLSX nao esta disponivel.");
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: "array", cellDates: true, cellFormula: true });
    const sheetName = findEffectiveSheet(workbook);
    if (!sheetName) throw new Error("Nao encontrei uma aba com coluna EMPRESA.");
    const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", blankrows: false });
    return datasetFromMatrix(rows, file.name, sheetName);
  }

  function findEffectiveSheet(workbook) {
    const candidates = workbook.SheetNames.map((name) => {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: "", blankrows: false });
      const headerIndex = rows.findIndex((row) => normalizeHeader(row?.[0]) === "empresa");
      if (headerIndex === -1) return null;
      return { name, score: scoreMatrixRows(rows, headerIndex) };
    }).filter(Boolean);
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.name || "";
  }

  async function parseCsvFile(file) {
    const text = decodeText(await file.arrayBuffer());
    const rows = parseCsv(text);
    if (!rows.length) throw new Error("CSV vazio.");
    const headers = rows[0].map((header) => normalizeHeader(header));
    if (headers.includes("nome do usuario") && headers.includes("departamento") && headers.includes("data evento")) {
      return datasetFromGateRows(rows, file.name);
    }
    return datasetFromMatrix(rows, file.name, file.name);
  }

  function decodeText(buffer) {
    let text = new TextDecoder("utf-8").decode(buffer);
    if (text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(buffer);
    return text;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    const delimiter = detectDelimiter(text);
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"') {
        if (inQuotes && next === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (char === delimiter && !inQuotes) {
        row.push(cell);
        cell = "";
        continue;
      }
      if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(cell);
        if (row.some((item) => cleanText(item))) rows.push(row);
        row = [];
        cell = "";
        continue;
      }
      cell += char;
    }
    row.push(cell);
    if (row.some((item) => cleanText(item))) rows.push(row);
    return rows;
  }

  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || "";
    const semicolons = (firstLine.match(/;/g) || []).length;
    const commas = (firstLine.match(/,/g) || []).length;
    return semicolons >= commas ? ";" : ",";
  }

  function datasetFromGateRows(rows, fileName) {
    const headers = rows[0].map((header) => normalizeHeader(header));
    const idxName = headers.indexOf("nome do usuario");
    const idxDepartment = headers.indexOf("departamento");
    const idxDate = headers.indexOf("data evento");
    const idxStatus = headers.indexOf("status");
    const idxEventType = headers.indexOf("tipo de evento");
    const peopleByDateCompany = new Map();
    const eventDates = [];

    rows.slice(1).forEach((row) => {
      const person = cleanText(row[idxName]);
      const department = cleanText(row[idxDepartment]) || "SEM EMPRESA";
      const date = parseEventDate(row[idxDate]);
      const status = normalizeHeader(row[idxStatus]);
      const eventType = normalizeHeader(row[idxEventType]);
      if (!person || !date) return;
      if (status && !status.includes("liberado")) return;
      if (eventType && eventType.includes("negado")) return;
      const dateKey = toIsoDate(date);
      const key = `${dateKey}||${department}`;
      if (!peopleByDateCompany.has(key)) peopleByDateCompany.set(key, new Set());
      peopleByDateCompany.get(key).add(normalizeHeader(person));
      eventDates.push(date);
    });

    if (!eventDates.length) throw new Error("CSV da catraca sem acessos liberados validos.");
    const latest = eventDates.reduce((max, item) => item > max ? item : max, eventDates[0]);
    const periodoKey = `${latest.getFullYear()}-${pad2(latest.getMonth() + 1)}`;
    const { year, monthIndex } = periodoToParts(periodoKey);
    const days = createMonthDays(year, monthIndex);
    const companyMap = new Map();

    peopleByDateCompany.forEach((people, key) => {
      const [dateKey, company] = key.split("||");
      const date = parseEventDate(dateKey);
      if (!date || date.getFullYear() !== year || date.getMonth() !== monthIndex) return;
      if (!companyMap.has(company)) companyMap.set(company, new Array(days.length).fill(0));
      companyMap.get(company)[date.getDate() - 1] = people.size;
    });

    return datasetFromCompanyMap(companyMap, {
      periodoKey,
      source: "Catraca",
      fileName,
      updatedAt: latest.toLocaleString("pt-BR"),
    });
  }

  function datasetFromMatrix(rows, fileName, sourceLabel) {
    const headerIndex = rows.findIndex((row) => normalizeHeader(row?.[0]) === "empresa");
    if (headerIndex === -1) throw new Error("Nao encontrei a linha de cabecalho EMPRESA.");
    const header = rows[headerIndex] || [];
    const dateColumns = [];
    for (let column = 1; column < header.length; column += 1) {
      const label = cleanText(header[column]);
      const normalized = normalizeHeader(label);
      if (!label || normalized.startsWith("total") || normalized.includes("media")) break;
      dateColumns.push(column);
    }
    if (!dateColumns.length) throw new Error("Nao encontrei colunas de datas na tabela.");

    const period = inferPeriod(header, sourceLabel, fileName);
    const days = dateColumns.map((column, index) => {
      const dayNumber = extractDayNumber(header[column]) || index + 1;
      return dayNumber;
    });
    const maxDay = Math.max(...days);
    const monthDays = createMonthDays(period.year, period.monthIndex).slice(0, maxDay);
    const totalIndex = findTotalRowIndex(rows, headerIndex + 1);
    const endIndex = totalIndex > -1 ? totalIndex : rows.length;
    const categories = [];
    let currentCategory = null;

    for (let rowIndex = headerIndex + 1; rowIndex < endIndex; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const label = cleanText(row[0]);
      if (!label) continue;
      const normalized = normalizeHeader(label);
      if (normalized.startsWith("total")) continue;

      const values = new Array(monthDays.length).fill(0);
      dateColumns.forEach((column, index) => {
        const dayIndex = Math.max(0, (days[index] || index + 1) - 1);
        if (dayIndex < values.length) values[dayIndex] = Math.max(0, Math.round(toNumber(row[column])));
      });

      if (isCategoryName(label) || !values.some((value) => value > 0)) {
        currentCategory = { name: label.toUpperCase(), companies: [] };
        categories.push(currentCategory);
        continue;
      }

      if (!currentCategory) {
        currentCategory = { name: guessCategory(label), companies: [] };
        categories.push(currentCategory);
      }
      currentCategory.companies.push({ name: label.toUpperCase(), values });
    }

    const filtered = categories
      .map((category) => ({
        name: category.name,
        companies: category.companies.filter((company) => company.values.some((value) => value > 0)),
      }))
      .filter((category) => category.companies.length);
    if (!filtered.length) throw new Error("A tabela nao possui empresas com valores numericos.");

    return {
      obraId: getObraId(),
      project: getObraLabel(),
      source: fileName.toLowerCase().endsWith(".csv") ? "CSV" : "Excel",
      updatedAt: new Date().toLocaleString("pt-BR"),
      year: period.year,
      monthIndex: period.monthIndex,
      periodoKey: `${period.year}-${pad2(period.monthIndex + 1)}`,
      days: monthDays,
      categories: filtered,
      fileName,
    };
  }

  function datasetFromCompanyMap(companyMap, meta) {
    const { year, monthIndex } = periodoToParts(meta.periodoKey);
    const days = createMonthDays(year, monthIndex);
    const categoriesByName = new Map();
    Array.from(companyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
      .forEach(([company, values]) => {
        const categoryName = guessCategory(company);
        if (!categoriesByName.has(categoryName)) {
          categoriesByName.set(categoryName, { name: categoryName, companies: [] });
        }
        categoriesByName.get(categoryName).companies.push({
          name: company.toUpperCase(),
          values: normalizeValues(values, days.length),
        });
      });

    return {
      obraId: getObraId(),
      project: getObraLabel(),
      source: meta.source,
      updatedAt: meta.updatedAt || new Date().toLocaleString("pt-BR"),
      year,
      monthIndex,
      periodoKey: meta.periodoKey,
      days,
      categories: Array.from(categoriesByName.values()),
      fileName: meta.fileName || "",
    };
  }

  function scoreMatrixRows(rows, headerIndex) {
    const header = rows[headerIndex] || [];
    const dateColumns = [];
    for (let column = 1; column < header.length; column += 1) {
      const label = cleanText(header[column]);
      if (!label || normalizeHeader(label).startsWith("total")) break;
      dateColumns.push(column);
    }
    let score = 0;
    rows.slice(headerIndex + 1).forEach((row) => {
      dateColumns.forEach((column) => {
        score += Math.max(0, toNumber(row?.[column]));
      });
    });
    return score;
  }

  function inferPeriod(header, sheetName, fileName) {
    const text = `${header.join(" ")} ${sheetName || ""} ${fileName || ""}`.toUpperCase();
    const yearMatch = text.match(/20\d{2}/);
    return {
      year: yearMatch ? Number(yearMatch[0]) : currentYear(),
      monthIndex: extractMonthIndex(text),
    };
  }

  function extractMonthIndex(value) {
    const text = removeAccents(value).toUpperCase();
    const aliases = [
      ["JAN", "JANEIRO"],
      ["FEV", "FEVEREIRO"],
      ["MAR", "MARCO"],
      ["ABR", "ABRIL"],
      ["MAI", "MAIO"],
      ["JUN", "JUNHO"],
      ["JUL", "JULHO"],
      ["AGO", "AGOSTO"],
      ["SET", "SETEMBRO"],
      ["OUT", "OUTUBRO"],
      ["NOV", "NOVEMBRO"],
      ["DEZ", "DEZEMBRO"],
    ];
    const index = aliases.findIndex((items) => items.some((item) => text.includes(item)));
    return index > -1 ? index : new Date().getMonth();
  }

  function extractDayNumber(value) {
    if (value instanceof Date) return value.getDate();
    if (typeof value === "number" && value > 0 && value <= 31) return value;
    const match = cleanText(value).match(/\b(\d{1,2})\b/);
    if (!match) return null;
    const day = Number(match[1]);
    return day >= 1 && day <= 31 ? day : null;
  }

  function findTotalRowIndex(rows, startIndex) {
    for (let index = startIndex; index < rows.length; index += 1) {
      const label = normalizeHeader(rows[index]?.[0]);
      if (label.startsWith("total diario") || label.startsWith("total geral")) return index;
    }
    return -1;
  }

  function parseEventDate(value) {
    if (value instanceof Date) return value;
    const text = cleanText(value);
    if (!text) return null;
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    const brMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (brMatch) return new Date(Number(brMatch[3]), Number(brMatch[2]) - 1, Number(brMatch[1]));
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function toIsoDate(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function isCategoryName(value) {
    const text = normalizeHeader(value);
    return [
      "indiretos",
      "civil",
      "serralharia / outros",
      "serralharia outros",
      "terraplanagem",
      "terraplenagem",
      "estrutura / metalica",
      "estruturas / metalica",
      "estrutura metalica",
      "estruturas metalica",
      "instalacoes",
      "outros",
    ].includes(text);
  }

  function guessCategory(company) {
    const text = normalizeHeader(company);
    if (/adm|topografia|treinamento|rba|cp controle/.test(text)) return "INDIRETOS";
    if (/campo|civil|empreiteira|construcao|construcoes|itadur|otm|betao/.test(text)) return "CIVIL";
    if (/serral|paisagismo|nunes/.test(text)) return "SERRALHARIA / OUTROS";
    if (/terra|txt|garrido/.test(text)) return "TERRAPLANAGEM";
    if (/estrutura|metal|t&a|s2|locabens|guindaste/.test(text)) return "ESTRUTURA / METALICA";
    return "OUTROS";
  }

  const PDF_COLORS = {
    navy: [22, 43, 69],
    blue: [42, 91, 145],
    blueSoft: [224, 234, 244],
    gray: [102, 113, 128],
    line: [207, 215, 224],
    paper: [247, 249, 251],
    weekend: [238, 241, 245],
    holiday: [223, 237, 248],
    white: [255, 255, 255],
    green: [32, 122, 87],
  };

  function pdfSourceLabel(computed) {
    return computed.dataset.derivedFromFrequency ? "Frequência" : "Histórico consolidado";
  }

  function sanitizePdfFilePart(value) {
    return removeAccents(value)
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase() || "OBRA";
  }

  function pdfDynamicText(value) {
    return cleanText(value).replace(/[–—]/g, "-");
  }

  function pdfFileName(computed) {
    return `Controle_Efetivo_${sanitizePdfFilePart(getObraLabel())}_${computed.dataset.periodoKey}.pdf`;
  }

  function pdfValue(value, dayIndex, computed) {
    return computed.dayHasData[dayIndex] ? formatInteger(value) : "—";
  }

  function pdfAverage(value) {
    return value === null || value === undefined ? "—" : formatDecimal(value);
  }

  function buildPdfTableRows(computed) {
    const rows = [];
    computed.categories.forEach((category) => {
      rows.push({ type: "category", label: category.name, categoryName: category.name });
      category.companies.forEach((company) => {
        rows.push({
          type: "company",
          label: company.name,
          categoryName: category.name,
          values: company.values,
          average: company.average,
        });
      });
      rows.push({
        type: "subtotal",
        label: `TOTAL ${category.name}`,
        categoryName: category.name,
        values: category.totals,
        average: category.average,
      });
    });
    rows.push({
      type: "grandTotal",
      label: "TOTAL GERAL DA OBRA",
      categoryName: "",
      values: computed.dailyTotals,
      average: computed.monthAverage,
    });
    return rows;
  }

  async function getEfetivoLogoPng() {
    if (typeof document === "undefined") return null;
    const image = document.querySelector(".efetivo-module__brand-logo");
    if (!image) return null;
    try {
      if (!image.complete) {
        await new Promise((resolve, reject) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", reject, { once: true });
        });
      }
      const width = Math.max(1, image.naturalWidth || 528);
      const height = Math.max(1, image.naturalHeight || 180);
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(1200, width * 2);
      canvas.height = Math.round(canvas.width * height / width);
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png", 1);
    } catch (error) {
      console.warn("[efetivo] logo indisponível para o PDF", error);
      return null;
    }
  }

  function drawPdfBrand(doc, logoData, x, y, darkBackground) {
    if (logoData && darkBackground) {
      try {
        doc.addImage(logoData, "PNG", x, y, 33, 11.2, undefined, "FAST");
        return;
      } catch (error) {
        console.warn("[efetivo] falha ao inserir logo no PDF", error);
      }
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.setTextColor(...(darkBackground ? PDF_COLORS.white : PDF_COLORS.navy));
    doc.text("build", x, y + 8);
    doc.setTextColor(43, 119, 181);
    doc.text("co", x + 15.2, y + 8);
  }

  function drawPdfKpi(doc, x, y, width, label, value, detail) {
    doc.setFillColor(...PDF_COLORS.white);
    doc.setDrawColor(...PDF_COLORS.line);
    doc.roundedRect(x, y, width, 27, 2, 2, "FD");
    doc.setFillColor(...PDF_COLORS.blue);
    doc.rect(x, y + 25.5, width, 1.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...PDF_COLORS.gray);
    doc.setFontSize(7.2);
    doc.text(label, x + 4, y + 6);
    doc.setTextColor(...PDF_COLORS.navy);
    doc.setFontSize(19);
    doc.text(value, x + 4, y + 17.5);
    doc.setTextColor(...PDF_COLORS.gray);
    doc.setFontSize(6.2);
    doc.text(detail, x + 4, y + 23);
  }

  function drawPdfWeeklyCards(doc, computed, x, y, width) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...PDF_COLORS.navy);
    doc.setFontSize(9);
    doc.text("MÉDIA DOS COLABORADORES POR SEMANA", x, y);
    const cards = computed.weeklyAverages.map((week, index) => ({
      label: `SEMANA ${index + 1}`,
      range: `${pad2(week.startDay)} A ${pad2(week.endDay)}`,
      value: pdfAverage(week.average),
    }));
    cards.push({ label: "MÉDIA DO MÊS", range: "DIAS INFORMADOS", value: pdfAverage(computed.monthAverage) });
    const gap = 2.5;
    const cardWidth = (width - gap * (cards.length - 1)) / cards.length;
    cards.forEach((card, index) => {
      const cardX = x + index * (cardWidth + gap);
      doc.setFillColor(...(index === cards.length - 1 ? PDF_COLORS.blueSoft : PDF_COLORS.white));
      doc.setDrawColor(...PDF_COLORS.line);
      doc.roundedRect(cardX, y + 4, cardWidth, 23, 1.5, 1.5, "FD");
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...PDF_COLORS.gray);
      doc.setFontSize(6.1);
      doc.text(card.label, cardX + 3, y + 9);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.5);
      doc.text(card.range, cardX + 3, y + 13);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...PDF_COLORS.navy);
      doc.setFontSize(14);
      doc.text(card.value, cardX + 3, y + 23);
    });
  }

  function drawPdfChart(doc, computed, x, y, width, height) {
    doc.setFillColor(...PDF_COLORS.white);
    doc.setDrawColor(...PDF_COLORS.line);
    doc.roundedRect(x, y, width, height, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...PDF_COLORS.navy);
    doc.setFontSize(9);
    doc.text("EVOLUÇÃO MENSAL DO EFETIVO", x + 5, y + 7);

    const values = computed.dailyTotals.map((value, index) => computed.dayHasData[index] ? toNumber(value) : null);
    const validValues = values.filter((value) => value !== null);
    const maxValue = Math.max(10, Math.ceil(Math.max(...validValues, 0) / 10) * 10);
    const plotX = x + 12;
    const plotY = y + 13;
    const plotWidth = width - 18;
    const plotHeight = height - 24;
    const denominator = Math.max(1, values.length - 1);

    doc.setDrawColor(226, 231, 237);
    [0, 0.5, 1].forEach((ratio) => {
      const lineY = plotY + plotHeight - plotHeight * ratio;
      doc.line(plotX, lineY, plotX + plotWidth, lineY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.5);
      doc.setTextColor(...PDF_COLORS.gray);
      doc.text(formatInteger(maxValue * ratio), plotX - 2, lineY + 1.5, { align: "right" });
    });

    let previousPoint = null;
    values.forEach((value, index) => {
      if (value === null) {
        previousPoint = null;
        return;
      }
      const pointX = plotX + plotWidth * index / denominator;
      const pointY = plotY + plotHeight - plotHeight * value / maxValue;
      if (previousPoint) {
        doc.setDrawColor(...PDF_COLORS.blue);
        doc.setLineWidth(0.8);
        doc.line(previousPoint.x, previousPoint.y, pointX, pointY);
      }
      doc.setFillColor(...PDF_COLORS.blue);
      doc.circle(pointX, pointY, 0.8, "F");
      previousPoint = { x: pointX, y: pointY };
    });

    computed.dataset.days.forEach((day, index) => {
      if (index !== 0 && index !== computed.dataset.days.length - 1 && day.day % 5 !== 0) return;
      const labelX = plotX + plotWidth * index / denominator;
      doc.setTextColor(...PDF_COLORS.gray);
      doc.setFontSize(5.5);
      doc.text(pad2(day.day), labelX, plotY + plotHeight + 5, { align: "center" });
    });
  }

  function drawPdfDashboard(doc, computed, logoData, generatedAt) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 10;
    doc.setFillColor(...PDF_COLORS.paper);
    doc.rect(0, 0, pageWidth, doc.internal.pageSize.getHeight(), "F");
    doc.setFillColor(...PDF_COLORS.navy);
    doc.rect(0, 0, pageWidth, 33, "F");
    drawPdfBrand(doc, logoData, 12, 8, true);

    doc.setTextColor(...PDF_COLORS.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("CONTROLE MENSAL CONSOLIDADO DE EFETIVO", pageWidth / 2, 13, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(`MÊS: ${monthTitle(computed.dataset.periodoKey).toUpperCase()}`, pageWidth / 2, 20, { align: "center" });

    doc.setDrawColor(82, 118, 155);
    doc.line(205, 6, 205, 27);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.3);
    doc.text("OBRA", 211, 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    const obraLines = doc.splitTextToSize(pdfDynamicText(getObraLabel()).toUpperCase(), 72).slice(0, 2);
    doc.text(obraLines, 211, 14);
    doc.setFontSize(5.8);
    doc.text(`ATUALIZADO: ${generatedAt.toLocaleString("pt-BR")}`, 211, 26);

    const kpiY = 40;
    const gap = 4;
    const kpiWidth = (pageWidth - margin * 2 - gap * 3) / 4;
    const kpis = [
      ["EFETIVO ATUAL", computed.effectiveTotal === null ? "—" : formatInteger(computed.effectiveTotal), computed.effectiveDay ? `DIA ${pad2(computed.effectiveDay.day)} · COLABORADORES` : "SEM DIA CONSOLIDADO"],
      ["EMPRESAS ATIVAS", formatInteger(computed.activeCompanies), "EMPRESAS NA COMPETÊNCIA"],
      ["MÉDIA SEMANAL", pdfAverage(computed.weeklyAverage), computed.latestWeek ? `DIAS ${pad2(computed.latestWeek.startDay)} A ${pad2(computed.latestWeek.endDay)}` : "SEM SEMANA CONSOLIDADA"],
      ["MÉDIA MENSAL", pdfAverage(computed.monthAverage), "APENAS DIAS INFORMADOS"],
    ];
    kpis.forEach((kpi, index) => drawPdfKpi(doc, margin + index * (kpiWidth + gap), kpiY, kpiWidth, ...kpi));
    drawPdfWeeklyCards(doc, computed, margin, 75, pageWidth - margin * 2);
    drawPdfChart(doc, computed, margin, 108, pageWidth - margin * 2, 76);

    const unresolvedCount = computed.dataset.unresolvedEmployeeDetails?.length || 0;
    if (unresolvedCount) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.2);
      doc.setTextColor(145, 92, 23);
      doc.text(`Observação: existem ${unresolvedCount} colaborador(es) presente(s) com vínculo empresarial não resolvido.`, margin, 190);
    }
  }

  function pdfTableLayout(doc, computed) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 10;
    const companyWidth = 54;
    const averageWidth = 15;
    const dayWidth = (pageWidth - margin * 2 - companyWidth - averageWidth) / computed.dataset.days.length;
    return { pageWidth, margin, companyWidth, averageWidth, dayWidth, tableWidth: pageWidth - margin * 2 };
  }

  function drawPdfTablePageHeader(doc, computed, logoData, continuationIndex, layout) {
    const { pageWidth, margin, companyWidth, averageWidth, dayWidth } = layout;
    doc.setFillColor(...PDF_COLORS.white);
    doc.rect(0, 0, pageWidth, doc.internal.pageSize.getHeight(), "F");
    drawPdfBrand(doc, logoData, margin, 7, false);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...PDF_COLORS.navy);
    doc.setFontSize(11.5);
    doc.text("CONTROLE TOTAL DIÁRIO POR EMPRESA", pageWidth / 2, 10, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    const continuation = continuationIndex > 1 ? ` · CONTINUAÇÃO ${continuationIndex - 1}` : "";
    doc.text(`${computed.dataset.days.length} DIAS DA COMPETÊNCIA${continuation}`, pageWidth / 2, 15, { align: "center" });
    doc.setFontSize(6.2);
    doc.text(pdfDynamicText(getObraLabel()), pageWidth - margin, 9, { align: "right", maxWidth: 78 });
    doc.text(monthTitle(computed.dataset.periodoKey).toUpperCase(), pageWidth - margin, 14, { align: "right" });

    const y = 20;
    const headerHeight = 11;
    doc.setFillColor(...PDF_COLORS.navy);
    doc.setDrawColor(...PDF_COLORS.line);
    doc.rect(margin, y, companyWidth, headerHeight, "FD");
    doc.setTextColor(...PDF_COLORS.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text("EMPRESA", margin + 2, y + 6.7);
    let x = margin + companyWidth;
    computed.dataset.days.forEach((day) => {
      const isWeekend = day.dow === "SAB" || day.dow === "DOM";
      const isHoliday = Object.prototype.hasOwnProperty.call(computed.dataset.holidays || {}, String(day.day));
      doc.setFillColor(...(isHoliday ? PDF_COLORS.holiday : isWeekend ? PDF_COLORS.weekend : PDF_COLORS.blueSoft));
      doc.setDrawColor(...PDF_COLORS.line);
      doc.rect(x, y, dayWidth, headerHeight, "FD");
      doc.setTextColor(...PDF_COLORS.navy);
      doc.setFontSize(4.7);
      doc.text(day.month, x + dayWidth / 2, y + 3, { align: "center" });
      doc.setFontSize(6.2);
      doc.text(pad2(day.day), x + dayWidth / 2, y + 6.7, { align: "center" });
      doc.setFontSize(4.5);
      doc.text(day.dow, x + dayWidth / 2, y + 9.5, { align: "center" });
      x += dayWidth;
    });
    doc.setFillColor(...PDF_COLORS.navy);
    doc.rect(x, y, averageWidth, headerHeight, "FD");
    doc.setTextColor(...PDF_COLORS.white);
    doc.setFontSize(6.2);
    doc.text("MÉDIA", x + averageWidth / 2, y + 6.7, { align: "center" });
    return y + headerHeight;
  }

  function getPdfCompanyText(doc, label, width) {
    let fontSize = 6.4;
    const safeLabel = pdfDynamicText(label);
    let lines = doc.splitTextToSize(safeLabel, width - 3);
    while (lines.length > 2 && fontSize > 4.6) {
      fontSize -= 0.3;
      doc.setFontSize(fontSize);
      lines = doc.splitTextToSize(safeLabel, width - 3);
    }
    return { fontSize, lines, height: Math.max(5.5, lines.length * 2.35 + 1.7) };
  }

  function drawPdfTableRow(doc, computed, row, y, layout, options) {
    const { margin, companyWidth, averageWidth, dayWidth } = layout;
    const isCategory = row.type === "category" || options?.continuation;
    const isSubtotal = row.type === "subtotal";
    const isGrandTotal = row.type === "grandTotal";
    let textInfo = {
      fontSize: 6.2,
      lines: [pdfDynamicText(options?.continuation ? `${row.categoryName} · CONTINUAÇÃO` : row.label)],
      height: 5.5,
    };
    if (row.type === "company") {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(textInfo.fontSize);
      textInfo = getPdfCompanyText(doc, row.label, companyWidth);
    }
    const rowHeight = isCategory ? 6 : textInfo.height;
    const background = isGrandTotal
      ? PDF_COLORS.navy
      : isCategory
        ? PDF_COLORS.blue
        : isSubtotal
          ? [218, 227, 237]
          : PDF_COLORS.white;
    const foreground = (isGrandTotal || isCategory) ? PDF_COLORS.white : PDF_COLORS.navy;

    doc.setFillColor(...background);
    doc.setDrawColor(...PDF_COLORS.line);
    if (isCategory) {
      doc.rect(margin, y, layout.tableWidth, rowHeight, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.4);
      doc.setTextColor(...foreground);
      doc.text(textInfo.lines[0], margin + 2, y + 4.1);
      return rowHeight;
    }

    doc.rect(margin, y, companyWidth, rowHeight, "FD");
    doc.setTextColor(...foreground);
    doc.setFont("helvetica", isSubtotal || isGrandTotal ? "bold" : "normal");
    doc.setFontSize(textInfo.fontSize);
    const lineHeight = 2.35;
    const textStartY = y + (rowHeight - textInfo.lines.length * lineHeight) / 2 + 1.9;
    doc.text(textInfo.lines, margin + 1.5, textStartY);

    let x = margin + companyWidth;
    row.values.forEach((value, dayIndex) => {
      const day = computed.dataset.days[dayIndex];
      const isWeekend = day.dow === "SAB" || day.dow === "DOM";
      const isHoliday = Object.prototype.hasOwnProperty.call(computed.dataset.holidays || {}, String(day.day));
      const hasData = computed.dayHasData[dayIndex];
      let cellBackground = background;
      if (!isSubtotal && !isGrandTotal) {
        cellBackground = !hasData ? PDF_COLORS.paper : isHoliday ? [239, 246, 252] : isWeekend ? [247, 248, 250] : PDF_COLORS.white;
      }
      doc.setFillColor(...cellBackground);
      doc.rect(x, y, dayWidth, rowHeight, "FD");
      doc.setTextColor(...(isGrandTotal ? PDF_COLORS.white : hasData ? PDF_COLORS.navy : [150, 158, 168]));
      doc.setFontSize(5.2);
      doc.text(pdfValue(value, dayIndex, computed), x + dayWidth / 2, y + rowHeight / 2 + 1.8, { align: "center" });
      x += dayWidth;
    });
    doc.setFillColor(...background);
    doc.rect(x, y, averageWidth, rowHeight, "FD");
    doc.setTextColor(...foreground);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.8);
    doc.text(pdfAverage(row.average), x + averageWidth / 2, y + rowHeight / 2 + 1.8, { align: "center" });
    return rowHeight;
  }

  function drawPdfTablePages(doc, computed, logoData) {
    const layout = pdfTableLayout(doc, computed);
    const rows = buildPdfTableRows(computed);
    const pageBottom = doc.internal.pageSize.getHeight() - 13;
    let tablePage = 1;
    doc.addPage("a4", "landscape");
    let y = drawPdfTablePageHeader(doc, computed, logoData, tablePage, layout);
    let currentCategory = "";

    rows.forEach((row, rowIndex) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.4);
      const rowHeight = row.type === "company" ? getPdfCompanyText(doc, row.label, layout.companyWidth).height : 6;
      const needsFollowingRow = row.type === "category" && rows[rowIndex + 1] ? 5.5 : 0;
      if (y + rowHeight + needsFollowingRow > pageBottom) {
        tablePage += 1;
        doc.addPage("a4", "landscape");
        y = drawPdfTablePageHeader(doc, computed, logoData, tablePage, layout);
        if (row.type !== "category" && currentCategory) {
          y += drawPdfTableRow(doc, computed, { type: "category", categoryName: currentCategory }, y, layout, { continuation: true });
        }
      }
      if (row.type === "category") currentCategory = row.categoryName;
      y += drawPdfTableRow(doc, computed, row, y, layout);
    });
  }

  function drawPdfFooters(doc, computed, generatedAt) {
    const pageCount = doc.getNumberOfPages();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const generatedLabel = generatedAt.toLocaleString("pt-BR").replace(",", "");
    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setDrawColor(...PDF_COLORS.line);
      doc.line(10, pageHeight - 8, pageWidth - 10, pageHeight - 8);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.8);
      doc.setTextColor(...PDF_COLORS.gray);
      doc.text(`Fonte: ${pdfSourceLabel(computed)} · Relatório gerado em ${generatedLabel}`, 10, pageHeight - 4.5);
      doc.text(`Página ${page} de ${pageCount}`, pageWidth - 10, pageHeight - 4.5, { align: "right" });
    }
  }

  function validatePdfModel(computed) {
    validateConsistency(
      computed.categories,
      computed.dailyTotals,
      normalizeValues(computed.dataset.uniquePresentTotals || [], computed.dataset.days.length),
      computed.dayHasData,
      computed.dataset.periodoKey,
      computed.dataset.derivedFromFrequency === true
    );
  }

  async function createEfetivoPdf(computed, options) {
    const config = options || {};
    const PdfConstructor = config.jsPDF || window.jspdf?.jsPDF;
    if (!PdfConstructor) throw new Error("Biblioteca jsPDF indisponível.");
    validatePdfModel(computed);
    const generatedAt = config.generatedAt || new Date();
    const logoData = Object.prototype.hasOwnProperty.call(config, "logoData")
      ? config.logoData
      : await getEfetivoLogoPng();
    const doc = new PdfConstructor({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    drawPdfDashboard(doc, computed, logoData, generatedAt);
    drawPdfTablePages(doc, computed, logoData);
    drawPdfFooters(doc, computed, generatedAt);
    const fileName = pdfFileName(computed);
    if (config.save !== false) doc.save(fileName);
    return { doc, fileName };
  }

  async function emitPdfReport() {
    if (state.pdfGenerating) return;
    if (!state.computed || !["real", "legacy"].includes(state.loadStatus) || !state.computed.dayHasData.some(Boolean)) {
      notify("Não há dados de efetivo para emitir nesta competência.", "error");
      return;
    }
    state.pdfGenerating = true;
    syncPermissions();
    try {
      await createEfetivoPdf(state.computed);
      notify("PDF do efetivo gerado com sucesso.", "success");
    } catch (error) {
      console.error("[efetivo] erro ao gerar PDF", error);
      notify(error?.message || "Não foi possível gerar o PDF do efetivo.", "error");
    } finally {
      state.pdfGenerating = false;
      syncPermissions();
    }
  }

  window.efetivoInit = function efetivoInit(pageRoot) {
    const root = pageRoot?.querySelector?.(".efetivo-module") || pageRoot;
    if (!root) return;
    state.root = root;
    ensurePdfButton(root);
    state.elements = getElements(root);
    bindPdfButton();

    if (!state.initialized) {
      setupMonthSelect();
      bindEvents();
      state.initialized = true;
    }

    const preferredPeriod = state.periodoKey || getCurrentPeriodoKey();
    ensurePeriodOption(preferredPeriod);
    state.periodoKey = preferredPeriod;
    state.dataset = state.dataset || createEmptyDataset(preferredPeriod);
    state.loadStatus = "loading";
    render();
    subscribeToCurrentPeriod();
  };

  window.efetivoRefresh = function efetivoRefresh() {
    if (!state.root) return;
    const current = normalizeDataset(
      state.dataset || createEmptyDataset(state.periodoKey || getCurrentPeriodoKey()),
      state.periodoKey || getCurrentPeriodoKey()
    );
    const merged = mergeEligibleCompanies(current, state.periodoKey || current.periodoKey);
    state.dataset = state.frequencyLoaded && state.frequencyData
      ? applyFrequencyToDataset(merged.dataset, state.periodoKey || current.periodoKey, state.frequencyData)
      : merged.dataset;
    render();
  };

  window.efetivoDestroyPage = function efetivoDestroyPage() {
    destroyChart();
    if (typeof state.unsubscribe === "function") {
      state.unsubscribe();
      state.unsubscribe = null;
    }
    state.hasRemoteSnapshot = false;
    state.frequencyLoadToken += 1;
    state.frequencyData = null;
    state.frequencyLoaded = false;
    state.frequencyLoading = false;
    state.loadStatus = "idle";
    state.pdfGenerating = false;
    state.dataset = null;
    state.computed = null;
  };

  window.empresaEstaAtivaNaCompetencia = function empresaEstaAtivaNaCompetencia(empresa, ano, mes) {
    return isCompanyEligibleForPeriod(empresa, `${Number(ano)}-${pad2(Number(mes))}`);
  };
  window.efetivoConsolidarFrequencia = consolidateFrequency;
  window.efetivoUtils = {
    createMonthDays,
    isCompanyEligibleForPeriod,
    isCompanyActiveOnDate,
    normalizeCategory,
    resolveEmployeeCompany,
    isPresenceValue,
    consolidateFrequency,
    getDaysWithData,
    averageDaily,
    averageForDataDays,
    weeklyAverages,
    getLastDayWithData,
    computeDataset,
    normalizeDataset,
    buildPdfTableRows,
    pdfSourceLabel,
    pdfValue,
    pdfAverage,
    sanitizePdfFilePart,
    pdfFileName,
    createEfetivoPdf,
  };
})();
// Compatibility notes for company/frequency consolidation:
// missing lifecycle dates are treated as open bounds in memory.
/*
Saved historical rows remain available when no frequency document exists.
Rows without empresaId use normalized company names as a fallback identity.
Invalid legacy dates do not silently exclude a registered company.
*/
// End of consolidation compatibility notes.
// The module closure above intentionally remains the executable endpoint.

// End of file.
