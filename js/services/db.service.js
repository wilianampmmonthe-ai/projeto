const COL_FUNCIONARIOS = "funcionarios";
const COL_EMPRESAS = "empresas";
const DOC_OBRA = "obra/atual";
const COL_FREQUENCIA = "frequencia";
const COL_EFETIVO = "efetivo";
const COL_EFETIVO_CONFIG = "efetivoConfig";
const COL_EFETIVO_IMPORTACOES = "efetivoImportacoes";
const COL_USUARIOS = "usuarios";

function dbNormalizeObraId(obraId) {
  return String(obraId || "").trim().toLowerCase();
}

function ensureAppCtx() {
  const ctx = window.APP_CTX || (window.APP_CTX = {
    userId: null,
    obraAtivaId: null,
    obrasPermitidas: [],
  });

  if (!Object.prototype.hasOwnProperty.call(ctx, "userId")) ctx.userId = null;
  if (!Array.isArray(ctx.obrasPermitidas)) ctx.obrasPermitidas = [];

  if (!Object.prototype.hasOwnProperty.call(ctx, "obraAtivaId") || ctx.obraAtivaId === undefined) {
    try {
      ctx.obraAtivaId = dbNormalizeObraId(localStorage.getItem("obraAtivaId")) || null;
    } catch (error) {
      ctx.obraAtivaId = null;
    }
  }

  ctx.obraAtivaId = dbNormalizeObraId(ctx.obraAtivaId) || null;

  return ctx;
}

function dbGetObraAtivaId() {
  return dbNormalizeObraId(ensureAppCtx().obraAtivaId);
}

function dbHasObraAtiva() {
  return Boolean(dbGetObraAtivaId());
}

function dbGetObraDocRef() {
  if (!dbHasObraAtiva()) {
    return firebase.firestore().doc(DOC_OBRA);
  }

  return firebase.firestore().collection("obras").doc(dbGetObraAtivaId());
}

function dbGetObraCollection(subcollection) {
  if (!dbHasObraAtiva()) {
    return firebase.firestore().collection(subcollection);
  }

  return dbGetObraDocRef().collection(subcollection);
}

function dbGetFrequenciaDocRef(periodoKey) {
  return dbGetObraCollection(COL_FREQUENCIA).doc(String(periodoKey));
}

function dbGetEfetivoDocRef(periodoKey) {
  return dbGetObraCollection(COL_EFETIVO).doc(String(periodoKey));
}

function dbAssertObraAtiva() {
  if (!dbHasObraAtiva()) {
    throw new Error("Nenhuma obra ativa selecionada.");
  }
}

function dbNormalizeFrequenciaData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) {
    return data.data;
  }

  if (
    Object.prototype.hasOwnProperty.call(data, "feriados") ||
    Object.prototype.hasOwnProperty.call(data, "terceirizados") ||
    Object.prototype.hasOwnProperty.call(data, "novoAtacarejo")
  ) {
    return data;
  }

  return {};
}

function dbNormalizeWrappedData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) {
    return data.data;
  }
  return data;
}

window.getObraPath = function getObraPath(subcollection) {
  return dbGetObraCollection(subcollection);
};

function dbLog(evento, detalhes) {
  if (detalhes === undefined) {
    console.log(`[db] ${evento}`);
    return;
  }

  console.log(`[db] ${evento}`, detalhes);
}

function dbLogPermissionError(scope, details, error) {
  console.error(`[PERMISSION ERROR][${scope}]`, {
    ...details,
    errorCode: error?.code || "",
    errorMessage: error?.message || String(error),
    error,
  });
}

function dbServerTimestamp() {
  return firebase.firestore.FieldValue.serverTimestamp();
}

function dbSanitizeRow(row) {
  const { id: _ignored, ...cleanRow } = row || {};
  return cleanRow;
}

function dbNormalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function dbGetBootstrapRole(email) {
  const normalized = dbNormalizeEmail(email);
  if (normalized === "mathnicacio@hotmail.com") return "admin";
  if (normalized === "teste@teste.com") return "editor";
  return "viewer";
}

function dbNormalizeRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return ["admin", "editor", "viewer"].includes(normalized) ? normalized : "";
}

function dbGetStoredObraAtivaId() {
  try {
    return dbNormalizeObraId(localStorage.getItem("obraAtivaId"));
  } catch (error) {
    return "";
  }
}

function dbNormalizeAccessMap(rawAcessos) {
  if (!rawAcessos || typeof rawAcessos !== "object" || Array.isArray(rawAcessos)) return {};

  return Object.entries(rawAcessos).reduce((acc, [obraId, entry]) => {
    const normalizedObraId = dbNormalizeObraId(obraId);
    if (!normalizedObraId || !entry || typeof entry !== "object" || Array.isArray(entry)) return acc;

    acc[normalizedObraId] = {
      enabled: entry.enabled !== false,
      role: dbNormalizeRole(entry.role) || "viewer",
    };
    return acc;
  }, {});
}

function dbBuildAccessForObra(rawAcessos, obraId, role) {
  const normalizedObraId = dbNormalizeObraId(obraId);
  const normalizedRole = dbNormalizeRole(role) || "viewer";
  const acessos = dbNormalizeAccessMap(rawAcessos);

  if (normalizedObraId) {
    acessos[normalizedObraId] = {
      enabled: true,
      role: normalizedRole,
    };
  }

  return acessos;
}

function dbNeedsAccessPatch(current, obraId, role) {
  const normalizedObraId = dbNormalizeObraId(obraId);
  if (!normalizedObraId) return false;

  const normalizedRole = dbNormalizeRole(role) || "viewer";
  const acessos = dbNormalizeAccessMap(current?.acessos);
  const entry = acessos[normalizedObraId];

  return !entry || entry.enabled !== true || entry.role !== normalizedRole || dbNormalizeObraId(current?.obraAtivaId) !== normalizedObraId;
}

async function dbBuildPayload(ref, row, extraFields) {
  const snap = await ref.get();
  const current = snap.exists ? snap.data() || {} : {};
  const id = String(ref.id);

  return {
    id,
    ...current,
    ...dbSanitizeRow(row),
    ...(extraFields || {}),
    updatedAt: dbServerTimestamp(),
    createdAt: current.createdAt || dbServerTimestamp(),
  };
}

function ouvirFuncionarios(cb) {
  const obraId = dbGetObraAtivaId() || null;
  const collectionRef = dbGetObraCollection(COL_FUNCIONARIOS);
  const path = `/${collectionRef.path}`;
  dbLog("listener funcionarios:start", { path, obraId, operation: "onSnapshot" });

  const q = collectionRef
    .orderBy("createdAt", "desc");

  return q.onSnapshot((snap) => {
    const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    dbLog("listener funcionarios:received", rows.length);
    cb(rows);
  }, (error) => {
    dbLogPermissionError("funcionarios", { path, obraId, operation: "onSnapshot" }, error);
    cb([]);
  });
}

async function salvarFuncionario(row) {
  const id = row?.id ? String(row.id) : crypto.randomUUID();
  const ref = dbGetObraCollection(COL_FUNCIONARIOS).doc(id);
  const payload = await dbBuildPayload(ref, row);

  dbLog("salvar funcionario", { id, tipo: payload.tipo });
  await ref.set(payload, { merge: true });

  return id;
}

async function removerFuncionario(id) {
  const docId = String(id);
  dbLog("remover funcionario", { id: docId });
  await dbGetObraCollection(COL_FUNCIONARIOS).doc(docId).delete();
}

function ouvirEmpresas(cb) {
  const obraId = dbGetObraAtivaId() || null;
  const collectionRef = dbGetObraCollection(COL_EMPRESAS);
  const path = `/${collectionRef.path}`;
  dbLog("listener empresas:start", { path, obraId, operation: "onSnapshot" });

  const q = collectionRef
    .orderBy("nome", "asc");

  return q.onSnapshot((snap) => {
    const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    dbLog("listener empresas:received", rows.length);
    cb(rows);
  }, (error) => {
    dbLogPermissionError("empresas", { path, obraId, operation: "onSnapshot" }, error);
    cb([]);
  });
}

async function salvarEmpresa(row) {
  const id = row?.id ? String(row.id) : crypto.randomUUID();
  const ref = dbGetObraCollection(COL_EMPRESAS).doc(id);
  const payload = await dbBuildPayload(ref, row);

  dbLog("salvar empresa", { id, nome: payload.nome || "" });
  await ref.set(payload, { merge: true });

  return id;
}

async function removerEmpresa(id) {
  const docId = String(id);
  dbLog("remover empresa", { id: docId });
  await dbGetObraCollection(COL_EMPRESAS).doc(docId).delete();
}

function ouvirObra(cb) {
  const obraId = dbGetObraAtivaId() || null;
  const ref = dbGetObraDocRef();
  const path = `/${ref.path}`;
  dbLog("listener obra:start", { path, obraId, operation: "onSnapshot" });

  return ref
    .onSnapshot((snap) => {
      const obra = snap.exists ? { ...snap.data(), id: snap.id } : null;
      dbLog("listener obra:received", obra ? obra.id : null);
      cb(obra);
    }, (error) => {
      dbLogPermissionError("obra", { path, obraId, operation: "onSnapshot" }, error);
      cb(null);
    });
}

async function salvarObra(obra) {
  const ref = dbGetObraDocRef();
  const payload = await dbBuildPayload(ref, obra);

  dbLog("salvar obra", { id: payload.id, nome: payload.nome || "" });
  await ref.set(payload, { merge: true });

  return payload.id;
}

function ouvirFrequencia(periodoKey, cb) {
  const docId = String(periodoKey);
  const obraId = dbGetObraAtivaId() || null;

  if (dbHasObraAtiva()) {
    const ref = dbGetFrequenciaDocRef(docId);
    const path = `/${ref.path}`;
    dbLog("listener frequencia:start", { path, obraId, periodoKey: docId, operation: "onSnapshot", source: "firestore" });
    return ref.onSnapshot((snap) => {
      const raw = snap.exists ? snap.data() || {} : null;
      const data = raw ? dbNormalizeFrequenciaData(raw) : null;
      const payload = data ? { id: docId, data } : null;
      dbLog("listener frequencia:received", { periodoKey: docId, hasData: Boolean(data), source: "firestore" });
      cb(payload);
    }, (error) => {
      dbLogPermissionError("frequencia", { path, obraId, periodoKey: docId, operation: "onSnapshot", source: "firestore" }, error);
      cb(null);
    });
  }

  const path = `/${COL_FREQUENCIA}/${docId}`;
  const ref = firebase.database().ref(path);
  dbLog("listener frequencia:start", { path, obraId, periodoKey: docId, operation: "on(value)", source: "realtime-database-legado" });
  const handler = ref.on("value", (snap) => {
    const data = snap.exists() ? snap.val() : null;
    const payload = data ? { id: docId, data } : null;
    dbLog("listener frequencia:received", { periodoKey: docId, hasData: Boolean(data), source: "rtdb" });
    cb(payload);
  }, (error) => {
    dbLogPermissionError("frequencia", { path, obraId, periodoKey: docId, operation: "on(value)", source: "realtime-database-legado" }, error);
    cb(null);
  });

  return () => ref.off("value", handler);
}

async function salvarFrequencia(periodoKey, data) {
  const docId = String(periodoKey);
  const payload = data || {};

  dbLog("salvar frequencia", { periodoKey: docId });

  if (dbHasObraAtiva()) {
    const ref = dbGetFrequenciaDocRef(docId);
    const snap = await ref.get();
    await ref.set({
      data: payload,
      updatedAt: dbServerTimestamp(),
      createdAt: snap.exists ? (snap.data()?.createdAt || dbServerTimestamp()) : dbServerTimestamp(),
    }, { merge: true });
    return docId;
  }

  const ref = firebase.database().ref(`${COL_FREQUENCIA}/${docId}`);
  await ref.set(payload);

  return docId;
}

async function obterUltimoPeriodoComFrequencia() {
  if (dbHasObraAtiva()) {
    const snap = await dbGetObraCollection(COL_FREQUENCIA)
      .orderBy(firebase.firestore.FieldPath.documentId(), "desc")
      .limit(1)
      .get();

    if (snap.empty) return "";
    return snap.docs[0]?.id || "";
  }

  const snap = await firebase.database().ref(COL_FREQUENCIA).get();
  if (!snap.exists()) return "";

  const keys = Object.keys(snap.val() || {})
    .filter((key) => /^\d{4}-\d{2}$/.test(key))
    .sort();

  return keys[keys.length - 1] || "";
}

async function obterFrequencia(periodoKey) {
  const docId = String(periodoKey);

  if (dbHasObraAtiva()) {
    const snap = await dbGetFrequenciaDocRef(docId).get();
    if (!snap.exists) return null;
    return { id: docId, data: dbNormalizeFrequenciaData(snap.data() || {}) };
  }

  const snap = await firebase.database().ref(`${COL_FREQUENCIA}/${docId}`).get();
  return snap.exists() ? { id: docId, data: snap.val() || {} } : null;
}

function ouvirEfetivo(periodoKey, cb) {
  const docId = String(periodoKey);
  dbLog("listener efetivo:start", { periodoKey: docId });

  if (!dbHasObraAtiva()) {
    cb(null);
    return () => {};
  }

  return dbGetEfetivoDocRef(docId).onSnapshot((snap) => {
    const raw = snap.exists ? snap.data() || {} : null;
    const data = raw ? dbNormalizeWrappedData(raw) : null;
    const payload = data ? { id: docId, data } : null;
    dbLog("listener efetivo:received", { periodoKey: docId, hasData: Boolean(data) });
    cb(payload);
  }, (error) => {
    console.error("[db] listener efetivo:error", error);
    cb(null);
  });
}

async function obterEfetivo(periodoKey) {
  dbAssertObraAtiva();
  const docId = String(periodoKey);
  const snap = await dbGetEfetivoDocRef(docId).get();
  if (!snap.exists) return null;
  return { id: snap.id, data: dbNormalizeWrappedData(snap.data() || {}) };
}

async function salvarEfetivo(periodoKey, data) {
  dbAssertObraAtiva();
  const docId = String(periodoKey);
  const payload = data || {};
  const ref = dbGetEfetivoDocRef(docId);
  const snap = await ref.get();

  dbLog("salvar efetivo", { periodoKey: docId });
  await ref.set({
    data: payload,
    updatedAt: dbServerTimestamp(),
    createdAt: snap.exists ? (snap.data()?.createdAt || dbServerTimestamp()) : dbServerTimestamp(),
  }, { merge: true });

  return docId;
}

async function salvarEfetivoCategorias(categorias) {
  dbAssertObraAtiva();
  const ref = dbGetObraCollection(COL_EFETIVO_CONFIG).doc("categorias");
  const snap = await ref.get();
  const list = Array.isArray(categorias)
    ? categorias.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  dbLog("salvar efetivo categorias", { total: list.length });
  await ref.set({
    categorias: Array.from(new Set(list)),
    updatedAt: dbServerTimestamp(),
    createdAt: snap.exists ? (snap.data()?.createdAt || dbServerTimestamp()) : dbServerTimestamp(),
  }, { merge: true });

  return "categorias";
}

async function salvarEfetivoImportacao(row) {
  dbAssertObraAtiva();
  const id = row?.id ? String(row.id) : crypto.randomUUID();
  const ref = dbGetObraCollection(COL_EFETIVO_IMPORTACOES).doc(id);
  const payload = await dbBuildPayload(ref, {
    periodoKey: String(row?.periodoKey || ""),
    fileName: String(row?.fileName || ""),
    source: String(row?.source || ""),
    categories: Number(row?.categories || 0),
    companies: Number(row?.companies || 0),
    importedAt: row?.importedAt || new Date().toISOString(),
  });

  dbLog("registrar efetivo importacao", { id, periodoKey: payload.periodoKey });
  await ref.set(payload, { merge: true });

  return id;
}

async function garantirUsuarioPerfil(user) {
  if (!user?.uid) throw new Error("Usuário autenticado inválido.");

  const uid = String(user.uid);
  const email = dbNormalizeEmail(user.email);
  const ref = firebase.firestore().collection(COL_USUARIOS).doc(uid);
  const path = `/${ref.path}`;
  let snap;
  dbLog("usuario perfil:get:start", { path, uid, operation: "get" });
  try {
    snap = await ref.get();
    dbLog("usuario perfil:get:ok", { path, uid, operation: "get", exists: snap.exists });
  } catch (error) {
    dbLogPermissionError("usuario-profile-get", { path, uid, operation: "get" }, error);
    throw error;
  }

  if (!snap.exists) {
    const payload = {
      id: uid,
      email,
      role: dbGetBootstrapRole(email),
      status: "active",
      createdAt: dbServerTimestamp(),
      updatedAt: dbServerTimestamp(),
    };

    dbLog("bootstrap usuario", { uid, email, role: payload.role });
    try {
      await ref.set(payload, { merge: true });
      dbLog("bootstrap usuario:write:ok", { path, uid, operation: "set(merge)" });
    } catch (error) {
      dbLogPermissionError("usuario-profile-create", { path, uid, operation: "set(merge)" }, error);
      throw error;
    }

    const activeObraId = dbGetStoredObraAtivaId() || dbGetObraAtivaId();
    if (payload.role === "admin" && activeObraId) {
      const accessPayload = {
        acessos: dbBuildAccessForObra({}, activeObraId, "admin"),
        obraAtivaId: activeObraId,
        updatedAt: dbServerTimestamp(),
      };
      dbLog("bootstrap usuario acesso obra", { uid, obraId: activeObraId, role: "admin" });
      try {
        await ref.set(accessPayload, { merge: true });
        dbLog("bootstrap usuario acesso obra:write:ok", { path, uid, obraId: activeObraId, operation: "set(merge)" });
      } catch (error) {
        dbLogPermissionError("usuario-profile-bootstrap-access", { path, uid, obraId: activeObraId, operation: "set(merge)" }, error);
        throw error;
      }
      return { ...payload, ...accessPayload, id: uid };
    }

    return { ...payload, id: uid };
  }

  const current = snap.data() || {};
  const storedEmail = dbNormalizeEmail(current.email);
  const nextEmail = dbNormalizeEmail(current.email || email);
  const role = dbNormalizeRole(current.role) || "viewer";
  const normalizedInMemory = {
    ...current,
    id: uid,
    email: nextEmail,
    role,
    status: current.status || "active",
    createdAt: current.createdAt || null,
  };

  if (storedEmail !== email || String(current.displayName || "") !== String(user.displayName || "")) {
    dbLog("usuario perfil:auth-divergence", {
      path,
      uid,
      firestoreEmail: storedEmail,
      authEmail: email,
      firestoreDisplayName: String(current.displayName || ""),
      authDisplayName: String(user.displayName || ""),
      action: "normalized-in-memory-only",
    });
  }

  const inMemoryNormalizationReasons = {
    missingEmail: !current.email,
    missingRole: !current.role,
    missingStatus: !current.status,
    missingCreatedAt: !current.createdAt,
  };
  if (Object.values(inMemoryNormalizationReasons).some(Boolean)) {
    dbLog("usuario perfil:normalized-in-memory", {
      path,
      uid,
      operation: "none",
      reasons: inMemoryNormalizationReasons,
    });
  }

  return normalizedInMemory;
}

async function obterUsuario(uid) {
  const docId = String(uid);
  const snap = await firebase.firestore().collection(COL_USUARIOS).doc(docId).get();
  return snap.exists ? { ...snap.data(), id: snap.id } : null;
}

function ouvirUsuarios(cb) {
  const obraId = dbGetObraAtivaId() || null;
  const collectionRef = firebase.firestore().collection(COL_USUARIOS);
  const path = `/${collectionRef.path}`;
  dbLog("listener usuarios:start", { path, obraId, operation: "onSnapshot" });

  return collectionRef
    .orderBy("email", "asc")
    .onSnapshot((snap) => {
      const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      dbLog("listener usuarios:received", rows.length);
      cb(rows);
    }, (error) => {
      dbLogPermissionError("usuarios", { path, obraId, operation: "onSnapshot" }, error);
      cb([]);
    });
}

async function salvarUsuario(uid, row) {
  const docId = String(uid);
  const ref = firebase.firestore().collection(COL_USUARIOS).doc(docId);
  const payload = await dbBuildPayload(ref, { ...row, email: dbNormalizeEmail(row?.email) });

  dbLog("salvar usuario", { uid: docId, role: payload.role, status: payload.status });
  await ref.set(payload, { merge: true });

  return docId;
}

function listenFuncionarios(cb) {
  return ouvirFuncionarios(cb);
}

function listenEmpresas(cb) {
  return ouvirEmpresas(cb);
}

function listenObra(cb) {
  return ouvirObra(cb);
}

function listenFrequencia(periodoKey, cb) {
  return ouvirFrequencia(periodoKey, cb);
}

async function getFrequencia(periodoKey) {
  return obterFrequencia(periodoKey);
}

async function upsertFuncionario(row) {
  return salvarFuncionario(row);
}

async function deleteFuncionario(id) {
  return removerFuncionario(id);
}

async function upsertEmpresa(row) {
  return salvarEmpresa(row);
}

async function deleteEmpresa(id) {
  return removerEmpresa(id);
}

async function setObra(obra) {
  return salvarObra(obra);
}

async function saveFrequencia(periodoKey, data) {
  return salvarFrequencia(periodoKey, data);
}

async function getLatestFrequenciaPeriodoKey() {
  return obterUltimoPeriodoComFrequencia();
}

function listenEfetivo(periodoKey, cb) {
  return ouvirEfetivo(periodoKey, cb);
}

async function getEfetivo(periodoKey) {
  return obterEfetivo(periodoKey);
}

async function saveEfetivo(periodoKey, data) {
  return salvarEfetivo(periodoKey, data);
}

async function saveEfetivoCategorias(categorias) {
  return salvarEfetivoCategorias(categorias);
}

async function saveEfetivoImportacao(row) {
  return salvarEfetivoImportacao(row);
}

async function ensureUsuarioProfile(user) {
  return garantirUsuarioPerfil(user);
}

async function getUsuario(uid) {
  return obterUsuario(uid);
}

function dataURLToBlob(dataURL) {
  const [meta, b64] = String(dataURL).split(",");
  const mimeMatch = /data:(.*?);base64/.exec(meta);
  const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function uploadDocDataURL({ funcionarioId, docKey, fileName, dataURL }) {
  const safeName = String(fileName || "arquivo").replace(/[^\w.\-]+/g, "_");
  const path = `documentos/${String(funcionarioId)}/${String(docKey)}/${Date.now()}_${safeName}`;

  const storageRef = firebase.storage().ref(path);
  const blob = dataURLToBlob(dataURL);

  await storageRef.put(blob);
  const url = await storageRef.getDownloadURL();

  return {
    storagePath: path,
    downloadURL: url,
    fileName: safeName
  };
}
