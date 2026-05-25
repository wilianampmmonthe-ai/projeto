// Utilitarios puros para copiar/sanitizar dados usados em persistencia e exportacao.

function cloneData(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value ?? fallback));
  } catch (e) {
    return fallback;
  }
}

window.cloneData = cloneData;
