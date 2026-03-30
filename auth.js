function watchSession(cb) {
  return firebase.auth().onAuthStateChanged(cb);
}

async function loginWithEmail(email, password) {
  const e = String(email || "").trim();
  const p = String(password || "");

  if (!e || !p) {
    const err = new Error("Preencha e-mail e senha.");
    err.code = "validation/empty";
    throw err;
  }

  return await firebase.auth().signInWithEmailAndPassword(e, p);
}

async function logout() {
  await firebase.auth().signOut();
}
