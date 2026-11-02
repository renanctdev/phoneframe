/** Normaliza e valida uma URL digitada pelo usuário antes de navegar. */
function normalizeUrl(raw) {
  const input = String(raw || "").trim();
  if (!input) throw new Error("URL vazia.");

  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input) ? input : `https://${input}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`URL inválida: ${raw}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Esquema não permitido: ${parsed.protocol} (apenas http/https).`);
  }

  return parsed.toString();
}

module.exports = { normalizeUrl };
