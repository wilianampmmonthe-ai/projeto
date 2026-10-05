(function dependencyLoaderModule(root) {
  "use strict";

  const DEFAULT_DEPENDENCIES = {
    jspdf: {
      src: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
      test: (scope) => Boolean(scope.jspdf?.jsPDF),
    },
    xlsx: {
      src: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
      test: (scope) => Boolean(scope.XLSX),
    },
    chartjs: {
      src: "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js",
      test: (scope) => Boolean(scope.Chart),
    },
    firebaseStorage: {
      src: "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage-compat.js",
      test: (scope) => typeof scope.firebase?.storage === "function",
    },
    efetivo: {
      src: "./js/modules/efetivo.js",
      test: (scope) => typeof scope.efetivoInit === "function",
    },
  };

  function createDependencyLoader(options) {
    const config = options || {};
    const scope = config.scope || root;
    const documentRef = config.document || scope.document;
    const timeoutMs = Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : 30000;
    const dependencies = { ...DEFAULT_DEPENDENCIES, ...(config.dependencies || {}) };
    const pending = new Map();

    function definition(name) {
      const dependency = dependencies[name];
      if (!dependency) throw new Error(`Dependência desconhecida: ${name}`);
      return dependency;
    }

    function isReady(name) {
      const dependency = definition(name);
      return Boolean(dependency.test?.(scope));
    }

    function removeFailedScript(script) {
      if (script?.parentNode) script.parentNode.removeChild(script);
    }

    function load(name) {
      const dependency = definition(name);
      if (isReady(name)) return Promise.resolve(scope);
      if (pending.has(name)) return pending.get(name);
      if (!documentRef?.createElement) {
        return Promise.reject(new Error(`Não foi possível carregar ${name}: documento indisponível.`));
      }

      const promise = new Promise((resolve, reject) => {
        const selector = `script[data-app-dependency="${name}"]`;
        let script = documentRef.querySelector?.(selector);
        let shouldAppend = false;
        if (script?.dataset?.loadState === "failed") {
          removeFailedScript(script);
          script = null;
        }
        if (!script) {
          script = documentRef.createElement("script");
          script.src = dependency.src;
          script.async = true;
          script.dataset.appDependency = name;
          script.dataset.loadState = "loading";
          shouldAppend = true;
        }

        let settled = false;
        let timer;
        const cleanup = () => {
          clearTimeout(timer);
          script.removeEventListener?.("load", onLoad);
          script.removeEventListener?.("error", onError);
        };
        const fail = (message) => {
          if (settled) return;
          settled = true;
          cleanup();
          script.dataset.loadState = "failed";
          removeFailedScript(script);
          pending.delete(name);
          reject(new Error(message));
        };
        const onLoad = () => {
          if (settled) return;
          if (!isReady(name)) {
            fail(`O arquivo de ${name} carregou, mas a biblioteca não ficou disponível.`);
            return;
          }
          settled = true;
          cleanup();
          script.dataset.loadState = "loaded";
          pending.delete(name);
          resolve(scope);
        };
        const onError = () => fail(`Não foi possível carregar ${name}. Verifique sua conexão e tente novamente.`);
        timer = setTimeout(() => fail(`Tempo esgotado ao carregar ${name}. Tente novamente.`), timeoutMs);
        script.addEventListener?.("load", onLoad, { once: true });
        script.addEventListener?.("error", onError, { once: true });
        if (shouldAppend) {
          (documentRef.head || documentRef.body || documentRef.documentElement).appendChild(script);
        }

        // Um script existente pode ter terminado entre o primeiro teste e os listeners.
        if (isReady(name)) onLoad();
      });

      pending.set(name, promise);
      return promise;
    }

    async function runWhenReady(name, options, action) {
      const ui = options || {};
      const button = ui.button?.closest?.("button") || ui.button;
      const originalDisabled = button?.disabled;
      const originalHtml = button?.innerHTML;
      try {
        if (!isReady(name)) {
          if (button) {
            button.disabled = true;
            if (ui.loadingText) button.textContent = ui.loadingText;
          }
          await load(name);
        }
        return await action();
      } catch (error) {
        const message = ui.errorMessage || error?.message || `Falha ao carregar ${name}.`;
        if (typeof scope.toast === "function") scope.toast(message, "error");
        else console.error(message, error);
        return undefined;
      } finally {
        if (button) {
          button.disabled = Boolean(originalDisabled);
          button.innerHTML = originalHtml;
        }
      }
    }

    return {
      load,
      isReady,
      runWhenReady,
      getState(name) {
        if (isReady(name)) return "loaded";
        return pending.has(name) ? "loading" : "idle";
      },
      loadJsPDF: () => load("jspdf"),
      loadXLSX: () => load("xlsx"),
      loadChartJS: () => load("chartjs"),
      loadFirebaseStorage: () => load("firebaseStorage"),
      loadEfetivoModule: () => load("efetivo"),
    };
  }

  const api = { createDependencyLoader, DEFAULT_DEPENDENCIES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root?.document) root.appDependencies = createDependencyLoader();
})(typeof window !== "undefined" ? window : globalThis);
