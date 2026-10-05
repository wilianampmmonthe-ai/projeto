(function initRenderLifecycle(global) {
  "use strict";

  const MODULES = ["dashboard", "terceirizados", "atacarejo", "empresas", "frequencia", "efetivo", "ata-terc", "ata-atac", "admin"];
  const PAGE_IDS = {
    dashboard: "page-dashboard",
    terceirizados: "page-terceirizados",
    atacarejo: "page-atacarejo",
    empresas: "page-empresas",
    frequencia: "page-frequencia",
    efetivo: "efetivo-page",
    "ata-terc": "page-ata-terc",
    "ata-atac": "page-ata-atac",
    admin: "page-admin",
  };

  // Dependências verificadas no código. Empresas usa funcionários nos
  // contadores; Efetivo consolida empresas, categorias, pessoas e frequência.
  const DEPENDENCIES = {
    funcionarios: ["dashboard", "terceirizados", "atacarejo", "empresas", "frequencia", "efetivo", "ata-terc", "ata-atac"],
    empresas: ["empresas", "efetivo"],
    categorias: ["empresas", "efetivo"],
    obra: ["dashboard", "atacarejo", "frequencia", "efetivo", "ata-atac"],
    frequencia: ["efetivo"],
    usuarios: ["admin"],
  };

  function createLifecycle(options = {}) {
    const dirty = Object.fromEntries(MODULES.map((module) => [module, true]));
    const renderers = new Map();
    const counters = Object.fromEntries(MODULES.map((module) => [module, 0]));
    const isActive = options.isActive || ((module) => {
      const pageId = PAGE_IDS[module];
      return Boolean(pageId && global.document?.getElementById(pageId)?.classList?.contains("active"));
    });

    function register(module, renderer) {
      if (MODULES.includes(module) && typeof renderer === "function") renderers.set(module, renderer);
    }

    function mark(module) {
      if (MODULES.includes(module)) dirty[module] = true;
    }

    function run(module, force = false) {
      if (!MODULES.includes(module) || (!force && !dirty[module])) return false;
      const renderer = renderers.get(module);
      if (typeof renderer !== "function") {
        dirty[module] = true;
        return false;
      }
      try {
        renderer();
        counters[module] += 1;
        dirty[module] = false;
        return true;
      } catch (error) {
        dirty[module] = true;
        if (typeof options.onError === "function") options.onError(module, error);
        else global.console?.error?.(`[lifecycle] falha ao renderizar ${module}`, error);
        return false;
      }
    }

    function notify(source) {
      const rendered = [];
      const invalidated = [];
      (DEPENDENCIES[source] || []).forEach((module) => {
        dirty[module] = true;
        if (isActive(module) && run(module)) rendered.push(module);
        else invalidated.push(module);
      });
      return { rendered, invalidated };
    }

    function invalidateAll() {
      MODULES.forEach(mark);
    }

    function renderActive() {
      const active = MODULES.find((module) => isActive(module));
      return active ? run(active) : false;
    }

    return {
      register,
      mark,
      notify,
      activate: (module) => run(module),
      invalidateAll,
      renderActive,
      isActive,
      isDirty: (module) => Boolean(dirty[module]),
      clear: (module) => { if (MODULES.includes(module)) dirty[module] = false; },
      snapshot: () => ({ ...dirty }),
      counters: () => ({ ...counters }),
      resetCounters: () => MODULES.forEach((module) => { counters[module] = 0; }),
    };
  }

  const api = { MODULES, PAGE_IDS, DEPENDENCIES, createLifecycle };
  global.renderLifecycleUtils = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (global.document) global.appRenderLifecycle = createLifecycle();
})(typeof window !== "undefined" ? window : globalThis);
