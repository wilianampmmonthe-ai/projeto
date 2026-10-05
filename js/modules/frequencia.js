(function initFrequencyPersistence(global) {
  "use strict";

  const STORAGE_KEY = "freqPendingChanges:v1";
  const DEFAULT_DEBOUNCE_MS = 250;
  const RECENT_TTL_MS = 5000;

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function logicalKey(entry) {
    return JSON.stringify([
      String(entry.obraId || ""),
      String(entry.periodoKey || ""),
      ...entry.segments.map((part) => String(part)),
    ]);
  }

  function getAtPath(source, segments) {
    let cursor = source;
    for (const segment of segments) {
      if (!cursor || typeof cursor !== "object") return undefined;
      cursor = cursor[String(segment)];
    }
    return cursor;
  }

  function setAtPath(target, segments, value, remove) {
    let cursor = target;
    segments.forEach((segment, index) => {
      const key = String(segment);
      if (index === segments.length - 1) {
        if (remove) delete cursor[key];
        else cursor[key] = clone(value);
        return;
      }
      if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) cursor[key] = {};
      cursor = cursor[key];
    });
  }

  function valuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function createSaveQueue(options = {}) {
    const pending = new Map();
    const recent = new Map();
    const observedSnapshots = new Map();
    const debounceMs = Number(options.debounceMs) || DEFAULT_DEBOUNCE_MS;
    const retryDelays = options.retryDelays || [1000, 2000, 4000, 8000, 10000];
    let sequence = 0;
    let timer = null;
    let retryAttempt = 0;
    let flushPromise = null;
    let lastError = null;

    function reportState() {
      const state = {
        pending: pending.size,
        saving: Boolean(flushPromise),
        error: lastError,
        status: lastError ? "error" : (pending.size || flushPromise ? "saving" : "saved"),
      };
      if (typeof options.onState === "function") options.onState(state);
      return state;
    }

    function persist() {
      if (typeof options.persist === "function") options.persist(Array.from(pending.values()));
    }

    function schedule(delay = debounceMs) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        flush().catch(() => {});
      }, delay);
    }

    function enqueue(change) {
      const entry = {
        obraId: String(change.obraId || ""),
        userId: String(change.userId || ""),
        periodoKey: String(change.periodoKey || ""),
        segments: change.segments.map((part) => String(part)),
        remove: Boolean(change.remove),
        value: change.remove ? undefined : clone(change.value),
        version: ++sequence,
      };
      pending.set(logicalKey(entry), entry);
      lastError = null;
      persist();
      schedule();
      reportState();
      return entry;
    }

    function restore(entries) {
      (Array.isArray(entries) ? entries : []).forEach((entry) => {
        if (!entry || !entry.periodoKey || !Array.isArray(entry.segments)) return;
        const restored = { ...entry, version: ++sequence };
        pending.set(logicalKey(restored), restored);
      });
      if (pending.size) schedule(50);
      reportState();
    }

    function pruneRecent() {
      const now = Date.now();
      recent.forEach((entry, key) => {
        if (entry.expiresAt <= now) recent.delete(key);
      });
    }

    function entriesForScope(obraId, periodoKey) {
      pruneRecent();
      const matches = (entry) => (
        String(entry.obraId || "") === String(obraId || "") &&
        String(entry.periodoKey) === String(periodoKey)
      );
      return [
        ...Array.from(recent.values()).filter(matches),
        ...Array.from(pending.values()).filter(matches),
      ];
    }

    function mergeRemote(obraId, periodoKey, remoteData) {
      const visible = clone(remoteData || {}) || {};
      entriesForScope(obraId, periodoKey).forEach((entry) => {
        setAtPath(visible, entry.segments, entry.value, entry.remove);
      });
      return visible;
    }

    function acknowledgeSnapshot(obraId, periodoKey, remoteData) {
      pruneRecent();
      pending.forEach((entry, key) => {
        if (String(entry.obraId || "") !== String(obraId || "") || String(entry.periodoKey) !== String(periodoKey)) return;
        const remoteValue = getAtPath(remoteData || {}, entry.segments);
        if ((entry.remove && remoteValue === undefined) || (!entry.remove && valuesEqual(remoteValue, entry.value))) {
          observedSnapshots.set(key, entry.version);
        }
      });
      recent.forEach((entry, key) => {
        if (String(entry.obraId || "") !== String(obraId || "") || String(entry.periodoKey) !== String(periodoKey)) return;
        const remoteValue = getAtPath(remoteData || {}, entry.segments);
        if ((entry.remove && remoteValue === undefined) || (!entry.remove && valuesEqual(remoteValue, entry.value))) {
          recent.delete(key);
        }
      });
    }

    async function flush(filter = {}) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (flushPromise) return flushPromise;

      const selected = Array.from(pending.entries()).filter(([, entry]) => {
        if (filter.obraId !== undefined && String(entry.obraId || "") !== String(filter.obraId || "")) return false;
        if (filter.periodoKey && String(entry.periodoKey) !== String(filter.periodoKey)) return false;
        return true;
      });
      if (!selected.length) {
        reportState();
        return true;
      }

      const groups = new Map();
      selected.forEach(([key, entry]) => {
        const groupKey = JSON.stringify([entry.obraId, entry.periodoKey]);
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push([key, entry]);
      });

      lastError = null;
      flushPromise = (async () => {
        const results = await Promise.allSettled(Array.from(groups.values()).map(async (group) => {
          const first = group[0][1];
          await options.write(first.periodoKey, group.map(([, entry]) => ({
            segments: entry.segments,
            remove: entry.remove,
            value: entry.value,
          })), first.obraId);
          group.forEach(([key, sent]) => {
            if (pending.get(key)?.version === sent.version) pending.delete(key);
            if (observedSnapshots.get(key) === sent.version) observedSnapshots.delete(key);
            else recent.set(key, { ...sent, expiresAt: Date.now() + RECENT_TTL_MS });
          });
        }));
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected) throw rejected.reason;
        retryAttempt = 0;
        persist();
        return true;
      })();

      reportState();
      try {
        return await flushPromise;
      } catch (error) {
        lastError = error || new Error("Erro ao salvar frequência.");
        persist();
        const retryDelay = retryDelays[Math.min(retryAttempt, retryDelays.length - 1)];
        retryAttempt += 1;
        schedule(retryDelay);
        throw lastError;
      } finally {
        flushPromise = null;
        reportState();
        if (pending.size && !lastError) schedule(0);
      }
    }

    return {
      enqueue,
      flush,
      restore,
      mergeRemote,
      acknowledgeSnapshot,
      getState: reportState,
      getPending: () => Array.from(pending.values()).map(clone),
      _logicalKey: logicalKey,
    };
  }

  const utils = { createSaveQueue, logicalKey, getAtPath, setAtPath, valuesEqual };
  global.freqPersistenceUtils = utils;
  if (typeof module !== "undefined" && module.exports) module.exports = utils;

  if (!global.document || typeof global.document.getElementById !== "function") return;

  function readStoredPending() {
    try { return JSON.parse(global.localStorage?.getItem(STORAGE_KEY) || "[]"); }
    catch (error) { return []; }
  }

  function persistPending(entries) {
    try {
      if (entries.length) global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entries));
      else global.localStorage?.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn("[freq] não foi possível persistir a fila local", error);
    }
  }

  function renderSyncState(state) {
    const indicator = global.document.getElementById("freqSyncStatus");
    if (!indicator) return;
    indicator.dataset.state = state.status;
    indicator.textContent = state.status === "error"
      ? "⚠ Erro ao salvar"
      : state.status === "saving" ? "● Salvando..." : "✓ Salvo";
    indicator.title = state.error?.message || "";
  }

  const queue = createSaveQueue({
    debounceMs: DEFAULT_DEBOUNCE_MS,
    persist: persistPending,
    onState: renderSyncState,
    write: async (periodoKey, changes, obraId) => {
      if (typeof global.updateFrequenciaFields !== "function") throw new Error("Serviço incremental de frequência indisponível.");
      return global.updateFrequenciaFields(periodoKey, changes, obraId || null);
    },
  });

  function currentContext() {
    return {
      obraId: String(global.APP_CTX?.obraAtivaId || ""),
      userId: String(global.firebase?.auth?.()?.currentUser?.uid || global.APP_CTX?.userId || ""),
    };
  }

  function queueChange(periodoKey, segments, value, remove = false) {
    const context = currentContext();
    const entry = queue.enqueue({ ...context, periodoKey, segments, value, remove });
    try {
      if (global.freqState?.data && typeof global.writeFreqCache === "function") global.writeFreqCache(global.freqState.data);
    } catch (error) {
      console.warn("[freq] cache local indisponível", error);
    }
    return entry;
  }

  global.freqQueueCellChange = (periodoKey, tipo, funcionarioId, dia, value) => (
    queueChange(periodoKey, [tipo, funcionarioId, String(dia)], value, value === null || value === undefined)
  );
  global.freqQueueFeriadoChange = (periodoKey, dia, value) => (
    queueChange(periodoKey, ["feriados", String(dia)], value, value === null || value === undefined)
  );
  global.freqFlushPending = (filter = {}) => queue.flush(filter);
  global.freqMergePendingChanges = (periodoKey, remoteData, obraId = currentContext().obraId) => {
    queue.acknowledgeSnapshot(obraId, periodoKey, remoteData);
    return queue.mergeRemote(obraId, periodoKey, remoteData);
  };
  global.freqGetSaveQueueState = () => queue.getState();
  // Única API oficial: força o flush da fila; não envia snapshots mensais.
  global.freqSaveData = () => queue.flush();
  global.__freqSaveQueue = queue;

  queue.restore(readStoredPending());
  global.addEventListener?.("pagehide", () => { queue.flush().catch(() => {}); });
  global.addEventListener?.("beforeunload", () => { queue.flush().catch(() => {}); });
})(typeof window !== "undefined" ? window : globalThis);
