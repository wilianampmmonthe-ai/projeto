// Helpers puros de formatacao e normalizacao. Nao manipular DOM, toast ou Firebase neste arquivo.

function normalizeObraId(obraId) {
  return String(obraId || "").trim().toLowerCase();
}

function humanizeObraId(obraId) {
  return normalizeObraId(obraId)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeUiText(msg) {
  let text = String(msg || "");
  if (!/[ÃÂâ]/.test(text)) return text;

  const replacements = [
    ["Ã¡", "á"], ["Ã ", "à"], ["Ã¢", "â"], ["Ã£", "ã"], ["Ã¤", "ä"],
    ["Ã©", "é"], ["Ã¨", "è"], ["Ãª", "ê"], ["Ã«", "ë"],
    ["Ã­", "í"], ["Ã¬", "ì"], ["Ã®", "î"], ["Ã¯", "ï"],
    ["Ã³", "ó"], ["Ã²", "ò"], ["Ã´", "ô"], ["Ãµ", "õ"], ["Ã¶", "ö"],
    ["Ãº", "ú"], ["Ã¹", "ù"], ["Ã»", "û"], ["Ã¼", "ü"],
    ["Ã", "Á"], ["Ã€", "À"], ["Ã‚", "Â"], ["Ãƒ", "Ã"], ["Ã„", "Ä"],
    ["Ã‰", "É"], ["Ãˆ", "È"], ["ÃŠ", "Ê"], ["Ã‹", "Ë"],
    ["Ã", "Í"], ["ÃŒ", "Ì"], ["ÃŽ", "Î"], ["Ã", "Ï"],
    ["Ã“", "Ó"], ["Ã’", "Ò"], ["Ã”", "Ô"], ["Ã•", "Õ"], ["Ã–", "Ö"],
    ["Ãš", "Ú"], ["Ã™", "Ù"], ["Ã›", "Û"], ["Ãœ", "Ü"],
    ["Ã§", "ç"], ["Ã‡", "Ç"], ["Ã±", "ñ"], ["Ã‘", "Ñ"],
    ["Ãƒ", "Ã"], ["Ã‚", "Â"],
    ["â€”", "—"], ["â€“", "–"], ["â€¢", "•"], ["â—", "●"], ["â˜°", "☰"], ["Ã—", "×"],
    ["Ã¢Å“ÂÃ¯Â¸Â", ""], ["Ã°Å¸â€”â€˜Ã¯Â¸Â", ""],
    [" Â· ", " • "], ["Â·", "•"], ["Â •", " •"], ["•Â", "•"],
    [" Â ", " "], ["Âº", "º"], ["Âª", "ª"], ["Â", ""]
  ];

  for (let pass = 0; pass < 4; pass += 1) {
    const before = text;
    replacements.forEach(([from, to]) => {
      text = text.split(from).join(to);
    });
    if (text === before) break;
  }

  return text;
}


window.normalizeObraId = normalizeObraId;
window.humanizeObraId = humanizeObraId;
window.normalizeUiText = normalizeUiText;
