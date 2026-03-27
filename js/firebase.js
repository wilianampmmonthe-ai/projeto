(function () {
  const cfg = window.__FIREBASE_CONFIG__;

  if (!cfg || !cfg.apiKey) {
    console.error("Firebase NÃO configurado.");
    return;
  }

  // ESSA LINHA É A MAIS IMPORTANTE
  firebase.initializeApp(cfg);

  console.log("Firebase inicializado com sucesso");
})();

