export function resolveUrl(input) {
  const cleaned = input.replace(/&amp;/g, "&");

  if (cleaned.startsWith("http")) {
    try {
      const url = new URL(cleaned);
      const u = url.searchParams.get("u");
      return u ? decodeURIComponent(u) : cleaned;
    } catch {
      return cleaned;
    }
  }

  return decodeURIComponent(cleaned);
}