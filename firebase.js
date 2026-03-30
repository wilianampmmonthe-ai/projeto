(function () {
  const cfg = { ...(window.__FIREBASE_CONFIG__ || {}) };

  if (!cfg.apiKey) {
    console.error("Firebase NÃƒO configurado.");
    return;
  }

  if (!cfg.databaseURL && cfg.projectId) {
    cfg.databaseURL = `https://${cfg.projectId}-default-rtdb.firebaseio.com`;
    console.warn("Firebase databaseURL ausente; usando URL derivada do projectId.", cfg.databaseURL);
  }

  if (!cfg.projectId) {
    console.error("Firebase projectId ausente.");
    return;
  }

  if (!firebase.apps?.length) {
    firebase.initializeApp(cfg);
  } else {
    console.warn("Firebase jÃ¡ inicializado; reutilizando app existente.");
  }

  console.log("Firebase inicializado com sucesso");
})();
