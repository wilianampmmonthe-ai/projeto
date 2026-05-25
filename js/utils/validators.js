// Helpers puros de validacao. Nao manipular DOM, toast ou Firebase neste arquivo.

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function isValidEmail(value) {
  const email = String(value || "").trim();
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function hasMinLength(value, min) {
  const target = Number(min);
  const minLength = Number.isFinite(target) ? target : 0;
  return String(value ?? "").trim().length >= minLength;
}

function isValidDateInput(value) {
  if (value instanceof Date) return !Number.isNaN(value.getTime());

  const text = String(value || "").trim();
  if (!text) return false;

  const inputDateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (inputDateMatch) {
    const year = Number(inputDateMatch[1]);
    const month = Number(inputDateMatch[2]);
    const day = Number(inputDateMatch[3]);
    const date = new Date(year, month - 1, day);

    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  return !Number.isNaN(new Date(text).getTime());
}

function isValidRequiredFields(payload, fields) {
  if (!payload || typeof payload !== "object" || !Array.isArray(fields)) return false;
  return fields.every((field) => !isBlank(payload[field]));
}

window.isBlank = isBlank;
window.isValidEmail = isValidEmail;
window.onlyDigits = onlyDigits;
window.hasMinLength = hasMinLength;
window.isValidDateInput = isValidDateInput;
window.isValidRequiredFields = isValidRequiredFields;
