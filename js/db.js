const COL_FUNCIONARIOS = "funcionarios";
const COL_EMPRESAS = "empresas";
const DOC_OBRA = "obra/atual";
const COL_FREQUENCIA = "frequencia";
const COL_USUARIOS = "usuarios";

function dbLog(evento, detalhes) {
  if (detalhes === undefined) {
    console.log(`[db] ${evento}`);
    return;
  }

  console.log(`[db] ${evento}`, detalhes);
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
  dbLog("listener funcionarios:start");

  const q = firebase.firestore()
    .collection(COL_FUNCIONARIOS)
    .orderBy("createdAt", "desc");

  return q.onSnapshot((snap) => {
    const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    dbLog("listener funcionarios:received", rows.length);
    cb(rows);
  }, (error) => {
    console.error("[db] listener funcionarios:error", error);
    cb([]);
  });
}

async function salvarFuncionario(row) {
  const id = row?.id ? String(row.id) : crypto.randomUUID();
  const ref = firebase.firestore().collection(COL_FUNCIONARIOS).doc(id);
  const payload = await dbBuildPayload(ref, row);

  dbLog("salvar funcionario", { id, tipo: payload.tipo });
  await ref.set(payload, { merge: true });

  return id;
}

async function removerFuncionario(id) {
  const docId = String(id);
  dbLog("remover funcionario", { id: docId });
  await firebase.firestore().collection(COL_FUNCIONARIOS).doc(docId).delete();
}

function ouvirEmpresas(cb) {
  dbLog("listener empresas:start");

  const q = firebase.firestore()
    .collection(COL_EMPRESAS)
    .orderBy("nome", "asc");

  return q.onSnapshot((snap) => {
    const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
    dbLog("listener empresas:received", rows.length);
    cb(rows);
  }, (error) => {
    console.error("[db] listener empresas:error", error);
    cb([]);
  });
}

async function salvarEmpresa(row) {
  const id = row?.id ? String(row.id) : crypto.randomUUID();
  const ref = firebase.firestore().collection(COL_EMPRESAS).doc(id);
  const payload = await dbBuildPayload(ref, row);

  dbLog("salvar empresa", { id, nome: payload.nome || "" });
  await ref.set(payload, { merge: true });

  return id;
}

async function removerEmpresa(id) {
  const docId = String(id);
  dbLog("remover empresa", { id: docId });
  await firebase.firestore().collection(COL_EMPRESAS).doc(docId).delete();
}

function ouvirObra(cb) {
  dbLog("listener obra:start");

  return firebase.firestore()
    .doc(DOC_OBRA)
    .onSnapshot((snap) => {
      const obra = snap.exists ? { ...snap.data(), id: snap.id } : null;
      dbLog("listener obra:received", obra ? obra.id : null);
      cb(obra);
    }, (error) => {
      console.error("[db] listener obra:error", error);
      cb(null);
    });
}

async function salvarObra(obra) {
  const ref = firebase.firestore().doc(DOC_OBRA);
  const payload = await dbBuildPayload(ref, obra);

  dbLog("salvar obra", { id: payload.id, nome: payload.nome || "" });
  await ref.set(payload, { merge: true });

  return payload.id;
}

function ouvirFrequencia(periodoKey, cb) {
  const docId = String(periodoKey);
  dbLog("listener frequencia:start", { periodoKey: docId });

  return firebase.firestore()
    .collection(COL_FREQUENCIA)
    .doc(docId)
    .onSnapshot((snap) => {
      const payload = snap.exists ? { ...snap.data(), id: snap.id } : null;
      dbLog("listener frequencia:received", { periodoKey: docId, hasData: Boolean(payload?.data) });
      cb(payload);
    }, (error) => {
      console.error("[db] listener frequencia:error", error);
      cb(null);
    });
}

async function salvarFrequencia(periodoKey, data) {
  const docId = String(periodoKey);
  const ref = firebase.firestore().collection(COL_FREQUENCIA).doc(docId);
  const payload = await dbBuildPayload(ref, { data }, { periodoKey: docId, data });

  dbLog("salvar frequencia", { periodoKey: docId });
  await ref.set(payload, { merge: true });

  return docId;
}

async function garantirUsuarioPerfil(user) {
  if (!user?.uid) throw new Error("Usuário autenticado inválido.");

  const uid = String(user.uid);
  const email = dbNormalizeEmail(user.email);
  const ref = firebase.firestore().collection(COL_USUARIOS).doc(uid);
  const snap = await ref.get();

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
    await ref.set(payload, { merge: true });
    return { ...payload, id: uid };
  }

  const current = snap.data() || {};
  const nextEmail = dbNormalizeEmail(current.email || email);
  const payload = {
    id: uid,
    email: nextEmail,
    role: current.role || dbGetBootstrapRole(nextEmail),
    status: current.status || "active",
    createdAt: current.createdAt || dbServerTimestamp(),
    updatedAt: dbServerTimestamp(),
  };

  if (current.email !== nextEmail || !current.role || !current.status || !current.createdAt) {
    dbLog("normalizar usuario", { uid, email: nextEmail, role: payload.role, status: payload.status });
    await ref.set(payload, { merge: true });
  }

  return { ...current, ...payload, id: uid };
}

async function obterUsuario(uid) {
  const docId = String(uid);
  const snap = await firebase.firestore().collection(COL_USUARIOS).doc(docId).get();
  return snap.exists ? { ...snap.data(), id: snap.id } : null;
}

function ouvirUsuarios(cb) {
  dbLog("listener usuarios:start");

  return firebase.firestore()
    .collection(COL_USUARIOS)
    .orderBy("email", "asc")
    .onSnapshot((snap) => {
      const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      dbLog("listener usuarios:received", rows.length);
      cb(rows);
    }, (error) => {
      console.error("[db] listener usuarios:error", error);
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
