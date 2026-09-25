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
    autoSyncPromise: null,
    autoSyncPending: false,
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
      "efetivo-file-input",
      "efetivo-import-button",
      "efetivo-save-button",
      "efetivo-print-button",
      "efetivo-refresh-button",
      "efetivo-status",
      "efetivo-source",
      "efetivo-updated-at",
      "efetivo-obra-label",
      "efetivo-kpi-total",
      "efetivo-kpi-companies",
      "efetivo-kpi-daily-average",
      "efetivo-kpi-month-average",
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

  function bindEvents() {
    const els = state.elements;
    els["efetivo-month-select"]?.addEventListener("change", async () => {
      await selectPeriod(els["efetivo-month-select"].value);
    });
    els["efetivo-import-button"]?.addEventListener("click", () => {
      if (!canEdit()) {
        notify("Seu perfil pode visualizar, mas nao editar o efetivo.", "error");
        return;
      }
      els["efetivo-file-input"]?.click();
    });
    els["efetivo-file-input"]?.addEventListener("change", handleFileSelect);
    els["efetivo-save-button"]?.addEventListener("click", () => persistDataset("Consolidado salvo."));
    els["efetivo-refresh-button"]?.addEventListener("click", () => subscribeToCurrentPeriod());
    els["efetivo-print-button"]?.addEventListener("click", printReport);
    els["efetivo-table"]?.addEventListener("input", handleTableInput);
    els["efetivo-table"]?.addEventListener("change", handleTableCommit);
    els["efetivo-table"]?.addEventListener("keydown", (event) => {
      if (event.target?.classList?.contains("efetivo-module__daily-input") && event.key === "Enter") {
        event.preventDefault();
        event.target.blur();
      }
    });
  }

  function setupMonthSelect() {
    const select = state.elements["efetivo-month-select"];
    if (!select) return;
    const year = currentYear();
    const options = Array.from({ length: 12 }, (_, index) => {
      const key = `${year}-${pad2(index + 1)}`;
      return `<option value="${key}">${MONTH_NAMES[index]} ${year}</option>`;
    });
    select.innerHTML = options.join("");
  }

  function ensurePeriodOption(periodoKey) {
    const select = state.elements["efetivo-month-select"];
    if (!select || !periodoKey) return;
    const exists = Array.from(select.options).some((option) => option.value === periodoKey);
    if (exists) return;
    const option = new Option(monthTitle(periodoKey), periodoKey);
    select.add(option);
  }

  function createEmptyDataset(periodoKey) {
    const { year, monthIndex } = periodoToParts(periodoKey);
    const days = createMonthDays(year, monthIndex);
    const empty = {
      obraId: getObraId(),
      project: getObraLabel(),
      source: "Manual",
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

    return {
      ...(raw || {}),
      obraId: raw?.obraId || getObraId(),
      project: raw?.project || getObraLabel(),
      source: raw?.source || "Manual",
      updatedAt: raw?.updatedAt || "",
      year: parts.year,
      monthIndex: parts.monthIndex,
      periodoKey: parts.periodoKey,
      days,
      fileName: raw?.fileName || "",
      categories: categories.map((category) => ({
        ...category,
        name: cleanText(category?.name || "OUTROS").toUpperCase(),
        companies: Array.isArray(category?.companies)
          ? category.companies.map((company) => ({
              ...company,
              empresaId: cleanText(company?.empresaId) || null,
              name: cleanText(company?.name || "SEM EMPRESA").toUpperCase(),
              values: normalizeValues(company?.values || [], days.length),
            }))
          : [],
      })).filter((category) => category.companies.length),
    };
  }

  function isCompanyEligibleForPeriod(empresa, periodoKey) {
    const bounds = getMonthBounds(periodoKey);
    const start = companyDateToIso(empresa?.dataInicioObra);
    const end = companyDateToIso(empresa?.dataFimObra);
    return (!start || start <= bounds.last) && (!end || end >= bounds.first);
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
          categoryName: cleanText(empresa?.categoriaEfetivo || empresa?.categoria || guessCategory(name)).toUpperCase(),
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

  function averagePositive(values) {
    const positives = values.filter((value) => toNumber(value) > 0);
    if (!positives.length) return 0;
    return sum(positives) / positives.length;
  }

  function latestPositive(values) {
    for (let index = values.length - 1; index >= 0; index -= 1) {
      if (toNumber(values[index]) > 0) return toNumber(values[index]);
    }
    return 0;
  }

  function computeDataset(dataset) {
    const dayCount = dataset.days.length;
    const categories = dataset.categories.map((category) => {
      const companies = category.companies.map((company) => ({
        name: company.name,
        values: normalizeValues(company.values, dayCount),
      }));
      const totals = sumArrays(companies.map((company) => company.values), dayCount);
      return { name: category.name, companies, totals };
    });
    const dailyTotals = sumArrays(categories.map((category) => category.totals), dayCount);
    const activeCompanies = categories.reduce((acc, category) => {
      return acc + category.companies.filter((company) => company.values.some((value) => value > 0)).length;
    }, 0);

    return {
      dataset,
      categories,
      dailyTotals,
      activeCompanies,
      effectiveTotal: latestPositive(dailyTotals),
      dailyAverage: averagePositive(dailyTotals),
      monthAverage: averagePositive(dailyTotals),
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
    if (els["efetivo-source"]) els["efetivo-source"].textContent = dataset.fileName || dataset.source || "Manual";
    if (els["efetivo-updated-at"]) els["efetivo-updated-at"].textContent = dataset.updatedAt || "--";
    if (els["efetivo-status"] && !els["efetivo-status"].dataset.busy) {
      els["efetivo-status"].textContent = dataset.updatedAt ? "Consolidado carregado." : STATUS_EMPTY;
    }
  }

  function renderKpis() {
    const computed = state.computed;
    state.elements["efetivo-kpi-total"].textContent = formatInteger(computed.effectiveTotal);
    state.elements["efetivo-kpi-companies"].textContent = formatInteger(computed.activeCompanies);
    state.elements["efetivo-kpi-daily-average"].textContent = formatDecimal(computed.dailyAverage);
    state.elements["efetivo-kpi-month-average"].textContent = formatDecimal(computed.monthAverage);
  }

  function renderTable() {
    const table = state.elements["efetivo-table"];
    const empty = state.elements["efetivo-empty"];
    const computed = state.computed;
    const editable = canEdit();

    if (!computed.categories.length) {
      table.innerHTML = "";
      if (empty) {
        empty.hidden = false;
        empty.textContent = "Nenhuma empresa encontrada. Importe uma planilha ou cadastre empresas para iniciar.";
      }
      return;
    }

    if (empty) empty.hidden = true;

    const headers = [
      "<th>Empresa</th>",
      ...computed.dataset.days.map((day) => `<th class="efetivo-module__day-head"><span>${escapeHtml(day.month)} ${pad2(day.day)}</span><small>${escapeHtml(day.dow)}</small></th>`),
      "<th>Total</th>",
      "<th>Media</th>",
    ];

    const rows = [];
    computed.categories.forEach((category, categoryIndex) => {
      rows.push(`<tr class="efetivo-module__category-row"><td colspan="${computed.dataset.days.length + 3}">${escapeHtml(category.name)}</td></tr>`);
      category.companies.forEach((company, companyIndex) => {
        rows.push(`<tr>
          <td class="efetivo-module__company-cell">${escapeHtml(company.name)}</td>
          ${company.values.map((value, dayIndex) => renderValueCell(value, categoryIndex, companyIndex, dayIndex, editable)).join("")}
          <td class="efetivo-module__total-cell">${formatInteger(sum(company.values))}</td>
          <td class="efetivo-module__total-cell">${formatDecimal(averagePositive(company.values))}</td>
        </tr>`);
      });
      rows.push(`<tr class="efetivo-module__category-total">
        <td>Total ${escapeHtml(category.name)}</td>
        ${category.totals.map((value) => `<td>${formatInteger(value)}</td>`).join("")}
        <td>${formatInteger(sum(category.totals))}</td>
        <td>${formatDecimal(averagePositive(category.totals))}</td>
      </tr>`);
    });

    rows.push(`<tr class="efetivo-module__grand-total">
      <td>Total geral da obra</td>
      ${computed.dailyTotals.map((value) => `<td>${formatInteger(value)}</td>`).join("")}
      <td>${formatInteger(sum(computed.dailyTotals))}</td>
      <td>${formatDecimal(computed.monthAverage)}</td>
    </tr>`);

    table.innerHTML = `<thead><tr>${headers.join("")}</tr></thead><tbody>${rows.join("")}</tbody>`;
  }

  function renderValueCell(value, categoryIndex, companyIndex, dayIndex, editable) {
    const numeric = Math.max(0, Math.round(toNumber(value)));
    if (!editable) {
      return `<td class="${numeric ? "" : "efetivo-module__zero"}">${formatInteger(numeric)}</td>`;
    }

    return `<td class="${numeric ? "" : "efetivo-module__zero"}">
      <input
        class="efetivo-module__daily-input"
        type="number"
        min="0"
        step="1"
        inputmode="numeric"
        value="${numeric}"
        aria-label="Efetivo do dia ${dayIndex + 1}"
        data-efetivo-category-index="${categoryIndex}"
        data-efetivo-company-index="${companyIndex}"
        data-efetivo-day-index="${dayIndex}"
      >
    </td>`;
  }

  function renderChart() {
    const canvas = state.elements["efetivo-chart"];
    const fallback = state.elements["efetivo-chart-fallback"];
    const computed = state.computed;
    if (!canvas || !computed) return;

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
    const data = computed.dailyTotals.map((value) => Math.round(toNumber(value) * 10) / 10);
    const max = Math.max(10, Math.ceil(Math.max(...data, 0) / 10) * 10 + 10);

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
          fill: true,
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
    const values = computed.dailyTotals.map((value) => Math.round(toNumber(value)));
    const width = 900;
    const height = 260;
    const left = 42;
    const right = 18;
    const top = 18;
    const bottom = 38;
    const max = Math.max(10, Math.ceil(Math.max(...values, 0) / 10) * 10);
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const dayCount = Math.max(1, values.length - 1);
    const points = values.map((value, index) => {
      const x = left + (plotWidth * index / dayCount);
      const y = top + plotHeight - (plotHeight * value / max);
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    }).join(" ");

    const labels = computed.dataset.days.map((day, index) => {
      if (index !== 0 && index !== computed.dataset.days.length - 1 && (index + 1) % 5 !== 0) return "";
      const x = left + (plotWidth * index / dayCount);
      return `<text x="${x}" y="${height - 12}" text-anchor="middle" font-size="11" font-weight="800" fill="#687180">${pad2(day.day)}</text>`;
    }).join("");

    return `<svg class="efetivo-module__svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolucao mensal do efetivo">
      <rect x="0" y="0" width="${width}" height="${height}" rx="8" fill="#ffffff"/>
      <line x1="${left}" y1="${top + plotHeight}" x2="${width - right}" y2="${top + plotHeight}" stroke="#d8dde4"/>
      <polyline points="${points}" fill="none" stroke="#f47a2a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
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
    ensurePeriodOption(key);
    const select = state.elements["efetivo-month-select"];
    if (select) select.value = key;
    state.dataset = createEmptyDataset(key);
    render();
    subscribeToCurrentPeriod();
  }

  function queueAutomaticSync(message) {
    if (!canEdit()) return;
    if (state.autoSyncPromise) {
      state.autoSyncPending = true;
      return;
    }
    const targetPeriod = state.periodoKey;
    state.autoSyncPromise = Promise.resolve()
      .then(() => {
        if (state.periodoKey !== targetPeriod) return;
        return persistDataset(message || "Empresas elegiveis sincronizadas.");
      })
      .finally(() => {
        state.autoSyncPromise = null;
        if (state.autoSyncPending) {
          state.autoSyncPending = false;
          queueAutomaticSync(message);
        }
      });
  }

  function subscribeToCurrentPeriod() {
    if (typeof state.unsubscribe === "function") {
      state.unsubscribe();
      state.unsubscribe = null;
    }

    if (!canView()) {
      renderNoAccess();
      return;
    }

    if (typeof window.listenEfetivo !== "function") {
      setStatus("Servico de efetivo indisponivel.", false);
      return;
    }

    setStatus(STATUS_LOADING, true);
    state.hasRemoteSnapshot = false;
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
      state.dataset = merged.dataset;
      state.hasRemoteSnapshot = true;
      setStatus(payload?.data ? "Consolidado carregado do Firebase." : STATUS_EMPTY, false);
      render();
      state.isRemoteApplying = false;
      if (canEdit() && (!hasSavedDataset || merged.added > 0 || merged.identityLinked > 0)) {
        queueAutomaticSync(hasSavedDataset
          ? "Cadastro de empresas sincronizado."
          : "Consolidado mensal criado com empresas elegiveis.");
      }
    });
  }

  function syncPermissions() {
    const editable = canEdit();
    const controls = [
      state.elements["efetivo-import-button"],
      state.elements["efetivo-save-button"],
      state.elements["efetivo-file-input"],
    ];
    controls.forEach((control) => {
      if (!control) return;
      control.disabled = !editable;
      control.style.pointerEvents = editable ? "" : "none";
      control.style.opacity = editable ? "" : "0.55";
    });
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

  async function persistDataset(successMessage) {
    if (!canEdit()) {
      notify("Seu perfil nao pode salvar o efetivo.", "error");
      return;
    }
    if (!state.dataset) return;
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
      state.elements["efetivo-month-select"].value = state.periodoKey;
      state.dataset = normalizeDataset(dataset, state.periodoKey);
      render();
      await persistDataset("Arquivo importado e salvo.");
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

  function printReport() {
    if (!state.computed) render();
    const computed = state.computed;
    if (!computed) return;

    const popup = window.open("", "_blank", "noopener,noreferrer,width=1280,height=900");
    if (!popup) {
      notify("O navegador bloqueou a janela de impressao.", "error");
      return;
    }

    const html = buildPrintHtml(computed);
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    window.setTimeout(() => {
      popup.print();
    }, 250);
  }

  function buildPrintHtml(computed) {
    const title = `Efetivo - ${monthTitle(computed.dataset.periodoKey)}`;
    return `<!doctype html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: A3 landscape; margin: 10mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Aptos, "Segoe UI", Arial, sans-serif; color: #292d33; background: #f4f5f7; }
          header { display: grid; grid-template-columns: 58mm 1fr 64mm; align-items: center; gap: 8mm; min-height: 24mm; padding: 5mm 7mm; margin-bottom: 6mm; background: #1f2024; color: #fff; }
          h1 { margin: 0; color: #fff; font-size: 14pt; font-weight: 900; text-align: center; text-transform: uppercase; }
          p { margin: 2mm 0 0; color: rgba(255,255,255,.78); font-size: 7.5pt; font-weight: 750; text-transform: uppercase; }
          .brand { color: #fff; font-size: 26pt; font-weight: 900; line-height: 1; text-transform: lowercase; }
          .brand strong { color: #f47a2a; }
          .meta { padding-left: 6mm; border-left: 1mm solid #f47a2a; }
          .meta strong { color: #f47a2a; }
          .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
          .kpi { border: 1px solid #d8dde4; border-bottom: 3px solid #f47a2a; border-radius: 8px; padding: 10px; background: #fff; }
          .kpi span { display: block; color: #687180; font-size: 11px; font-weight: 900; text-transform: uppercase; }
          .kpi strong { display: block; color: #2b2c30; font-size: 22px; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; font-size: 9px; }
          th, td { border: 1px solid #d8dde4; padding: 4px; text-align: center; }
          th:first-child, td:first-child { text-align: left; min-width: 150px; }
          th { background: #1f2024; color: #fff; }
          .cat td { background: #aab2bd; color: #fff; font-weight: 900; text-transform: uppercase; }
          .subtotal td { background: #dde2e8; font-weight: 900; }
          .total td { background: #1f2024; color: #fff; font-weight: 900; }
        </style>
      </head>
      <body>
        <header>
          <div class="brand">build<strong>co</strong></div>
          <div>
            <h1>RELACAO DO EFETIVO DAS EMPRESAS TERCEIRIZADAS</h1>
            <p>Periodo: ${escapeHtml(monthTitle(computed.dataset.periodoKey))}</p>
          </div>
          <div class="meta">
            <p><strong>Obra:</strong> ${escapeHtml(getObraLabel())}</p>
            <p>Fonte: ${escapeHtml(computed.dataset.fileName || computed.dataset.source || "Manual")}</p>
            <p>Atualizado: ${escapeHtml(computed.dataset.updatedAt || "--")}</p>
          </div>
        </header>
        <section class="kpis">
          <div class="kpi"><span>Efetivo total</span><strong>${formatInteger(computed.effectiveTotal)}</strong></div>
          <div class="kpi"><span>Empresas ativas</span><strong>${formatInteger(computed.activeCompanies)}</strong></div>
          <div class="kpi"><span>Media diaria</span><strong>${formatDecimal(computed.dailyAverage)}</strong></div>
          <div class="kpi"><span>Media mensal</span><strong>${formatDecimal(computed.monthAverage)}</strong></div>
        </section>
        ${buildPrintTable(computed)}
      </body>
      </html>`;
  }

  function buildPrintTable(computed) {
    const headers = [
      "<th>Empresa</th>",
      ...computed.dataset.days.map((day) => `<th>${pad2(day.day)}<br>${escapeHtml(day.dow)}</th>`),
      "<th>Total</th>",
      "<th>Media</th>",
    ];
    const rows = [];
    computed.categories.forEach((category) => {
      rows.push(`<tr class="cat"><td colspan="${computed.dataset.days.length + 3}">${escapeHtml(category.name)}</td></tr>`);
      category.companies.forEach((company) => {
        rows.push(`<tr>
          <td>${escapeHtml(company.name)}</td>
          ${company.values.map((value) => `<td>${formatInteger(value)}</td>`).join("")}
          <td>${formatInteger(sum(company.values))}</td>
          <td>${formatDecimal(averagePositive(company.values))}</td>
        </tr>`);
      });
      rows.push(`<tr class="subtotal">
        <td>Total ${escapeHtml(category.name)}</td>
        ${category.totals.map((value) => `<td>${formatInteger(value)}</td>`).join("")}
        <td>${formatInteger(sum(category.totals))}</td>
        <td>${formatDecimal(averagePositive(category.totals))}</td>
      </tr>`);
    });
    rows.push(`<tr class="total">
      <td>Total geral da obra</td>
      ${computed.dailyTotals.map((value) => `<td>${formatInteger(value)}</td>`).join("")}
      <td>${formatInteger(sum(computed.dailyTotals))}</td>
      <td>${formatDecimal(computed.monthAverage)}</td>
    </tr>`);
    return `<table><thead><tr>${headers.join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  }

  window.efetivoInit = function efetivoInit(pageRoot) {
    const root = pageRoot?.querySelector?.(".efetivo-module") || pageRoot;
    if (!root) return;
    state.root = root;
    state.elements = getElements(root);

    if (!state.initialized) {
      setupMonthSelect();
      bindEvents();
      state.initialized = true;
    }

    const preferredPeriod = state.periodoKey || getCurrentPeriodoKey();
    ensurePeriodOption(preferredPeriod);
    state.elements["efetivo-month-select"].value = preferredPeriod;
    state.periodoKey = preferredPeriod;
    state.dataset = state.dataset || createEmptyDataset(preferredPeriod);
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
    state.dataset = merged.dataset;
    render();
    if ((merged.added > 0 || merged.identityLinked > 0) && state.hasRemoteSnapshot && canEdit()) {
      queueAutomaticSync("Cadastro de empresas sincronizado.");
    }
  };

  window.efetivoDestroyPage = function efetivoDestroyPage() {
    destroyChart();
    if (typeof state.unsubscribe === "function") {
      state.unsubscribe();
      state.unsubscribe = null;
    }
    state.hasRemoteSnapshot = false;
  };
})();
// Compatibility notes for automatic company synchronization:
// missing lifecycle dates are treated as open bounds.
/*
Historical rows and their values are never removed by the automatic merge.
Rows without empresaId use normalized company names as a fallback identity.
Invalid legacy dates do not silently exclude a registered company.
*/
// End of synchronization compatibility notes.
// The module closure above intentionally remains the executable endpoint.

// End of file.
