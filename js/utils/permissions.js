// Normalizadores e resolvedores puros de permissoes por obra.

function normalizeRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return ["admin", "editor", "viewer"].includes(normalized) ? normalized : "";
}

function normalizeAllowedObras(rawObras) {
  if (Array.isArray(rawObras)) {
    return rawObras
      .map((obraId) => normalizeObraId(obraId))
      .filter(Boolean);
  }

  if (rawObras && typeof rawObras === "object") {
    return Object.keys(rawObras)
      .filter((obraId) => Boolean(rawObras[obraId]))
      .map((obraId) => normalizeObraId(obraId))
      .filter(Boolean);
  }

  return [];
}

function getEnabledObrasFromAcessos(profile) {
  if (!profile?.acessos || typeof profile.acessos !== "object" || Array.isArray(profile.acessos)) {
    return [];
  }

  const enabled = new Set();
  Object.entries(profile.acessos).forEach(([obraId, entry]) => {
    const normalizedObraId = normalizeObraId(obraId);
    if (!normalizedObraId) return;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    if (entry.enabled === true) enabled.add(normalizedObraId);
  });

  return Array.from(enabled);
}

function normalizeAccessMap(rawAcessos) {
  if (!rawAcessos || typeof rawAcessos !== "object" || Array.isArray(rawAcessos)) return {};

  return Object.entries(rawAcessos).reduce((acc, [obraId, entry]) => {
    const normalizedObraId = normalizeObraId(obraId);
    if (!normalizedObraId || !entry || typeof entry !== "object" || Array.isArray(entry)) return acc;

    acc[normalizedObraId] = {
      enabled: entry.enabled !== false,
      role: normalizeRole(entry.role) || "viewer",
    };
    return acc;
  }, {});
}

function getLegacyObrasMap(rawObras) {
  return normalizeAllowedObras(rawObras).reduce((acc, obraId) => {
    acc[obraId] = true;
    return acc;
  }, {});
}

function getPermittedObras(profile) {
  const permitted = new Set(Object.keys(getLegacyObrasMap(profile?.obras)));

  getEnabledObrasFromAcessos(profile).forEach((obraId) => {
    permitted.add(obraId);
  });

  Object.entries(normalizeAccessMap(profile?.acessos)).forEach(([obraId, entry]) => {
    if (!entry.enabled) permitted.delete(obraId);
  });

  return Array.from(permitted);
}

function resolveLegacyAccessForObra(profile, obraId) {
  const normalizedObraId = normalizeObraId(obraId);
  if (!normalizedObraId) return null;

  const legacyObras = getLegacyObrasMap(profile?.obras);
  const hasLegacyObras = Object.keys(legacyObras).length > 0;
  const globalRole = normalizeRole(profile?.role) || "viewer";

  if (hasLegacyObras && !legacyObras[normalizedObraId]) {
    return null;
  }

  return {
    enabled: true,
    role: globalRole,
    source: hasLegacyObras ? "fallback:obras+role" : "fallback:role-global",
  };
}

function getAvailableObrasForUser(profile) {
  const enabledFromAcessos = getEnabledObrasFromAcessos(profile);
  if (enabledFromAcessos.length) return enabledFromAcessos;
  return getPermittedObras(profile);
}

function normalizeUserProfile(profile, fallbackUser) {
  const email = String(profile?.email || fallbackUser?.email || "").trim().toLowerCase();
  return {
    ...(profile || {}),
    id: String(profile?.id || fallbackUser?.uid || ""),
    email,
    role: normalizeRole(profile?.role) || "viewer",
    status: String(profile?.status || "active"),
    obras: getLegacyObrasMap(profile?.obras),
    acessos: normalizeAccessMap(profile?.acessos),
    obraAtivaId: normalizeObraId(profile?.obraAtivaId),
    createdAt: profile?.createdAt || null,
    updatedAt: profile?.updatedAt || null,
  };
}

window.normalizeRole = normalizeRole;
window.normalizeAllowedObras = normalizeAllowedObras;
window.getEnabledObrasFromAcessos = getEnabledObrasFromAcessos;
window.normalizeAccessMap = normalizeAccessMap;
window.getLegacyObrasMap = getLegacyObrasMap;
window.getPermittedObras = getPermittedObras;
window.resolveLegacyAccessForObra = resolveLegacyAccessForObra;
window.getAvailableObrasForUser = getAvailableObrasForUser;
window.normalizeUserProfile = normalizeUserProfile;
