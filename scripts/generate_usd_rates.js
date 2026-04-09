/**
 * generate_usd_rates.mjs
 *
 * Reads USD_rates.csv and USD_volume_tiers.csv from /public
 * and writes USD_rates.json to /public.
 *
 * Place this script in a sub-folder of your project root (e.g. scripts/).
 * Place both CSV files in /public.
 *
 * Usage:  node scripts/generate_usd_rates.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse";

// __dirname resolves to the project root when this file lives one level deep
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(path.resolve(__filename, ".."));

const PUBLIC = path.join(__dirname, "public");
const RATES_CSV = path.join(PUBLIC, "USD_rates.csv");
const TIERS_CSV = path.join(PUBLIC, "USD_volume_tiers.csv");
const OUTPUT_JSON = path.join(PUBLIC, "USD_rates.json");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Stream a CSV file into an array of raw string-array rows. */
async function readCSVRows(filePath) {
  const rows = [];
  const parser = fs.createReadStream(filePath).pipe(
    parse({ relax_column_count: true }) // do NOT trim here; we need newlines inside headers
  );
  for await (const row of parser) {
    rows.push(row);
  }
  return rows;
}

/**
 * Normalise a header cell:
 *   - collapse embedded newlines / multiple spaces into a single space
 *   - strip leading/trailing whitespace
 * e.g.  "Authentication-\nInternational"  →  "Authentication- International"
 */
function normalizeHeader(h) {
  return (h || "").replace(/[\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/** Remove thousands-commas and parse to integer.  Returns null for n/a / -- / empty. */
function toInt(str) {
  const s = (str || "").trim();
  if (!s || s.toLowerCase() === "n/a" || s === "--") return null;
  return parseInt(s.replace(/,/g, ""), 10);
}

/** Parse float.  Returns null for n/a / empty. */
function toFloat(str) {
  const s = (str || "").trim();
  if (!s || s.toLowerCase() === "n/a") return null;
  return parseFloat(s);
}

/**
 * Convert a raw rate cell to its JSON value:
 *   "n/a" or blank  →  "N/A"
 *   numeric string  →  float
 */
function toRateOrNA(str) {
  const s = (str || "").trim();
  if (!s || s.toLowerCase() === "n/a") return "N/A";
  return parseFloat(s);
}

/**
 * Convert a "vs. List rate" cell like "-5%" to the discount label "5%".
 * "0%" (List rate row) returns null so no discount key is added.
 */
function toDiscount(str) {
  const s = (str || "").trim();
  if (!s || s === "0%") return null;
  return s.replace(/^-/, ""); // "-5%" → "5%"
}

/**
 * Build one tier object from raw cells.
 * Returns null when the whole section is n/a (e.g. no Auth-Intl for a market).
 */
function buildTier(fromStr, toStr, typeStr, rateStr, discStr) {
  const from = toInt(fromStr);
  if (from === null) return null; // section is n/a

  const to = (toStr || "").trim() === "--" ? null : toInt(toStr);
  const rate = toFloat(rateStr);
  const type = (typeStr || "").trim();
  const discount = toDiscount(discStr);

  const tier = { from, to, rate, type };
  if (discount) tier.discount = discount; // only present for Tier rate rows
  return tier;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 – Parse USD_rates.csv
// ─────────────────────────────────────────────────────────────────────────────

async function parseRatesCSV() {
  const rows = await readCSVRows(RATES_CSV);

  // The real header row is the first row whose first cell (normalised) equals "Market"
  const headerIdx = rows.findIndex(
    (row) => normalizeHeader(row[0]) === "Market"
  );
  if (headerIdx === -1) throw new Error("Could not find header row in USD_rates.csv");

  // Build a column-name → index map (robust to future column reordering)
  const headerCells = rows[headerIdx].map(normalizeHeader);
  const col = {};
  headerCells.forEach((name, i) => { col[name] = i; });

  // Authentication-International column name may contain a newline in the source file;
  // after normalisation it becomes something like "Authentication- International".
  // Find it by partial match so future minor name changes don't break us.
  const authIntlKey = Object.keys(col).find(
    (k) => k.toLowerCase().includes("authentication") && k.toLowerCase().includes("international")
  );

  const ratesMap = {};
  for (const row of rows.slice(headerIdx + 1)) {
    const market = (row[col["Market"]] || "").trim();
    if (!market) continue; // skip blank rows

    ratesMap[market] = {
      currency: (row[col["Currency"]] || "USD").trim(),
      marketing: toRateOrNA(row[col["Marketing"]]),
      utility_base: toRateOrNA(row[col["Utility"]]),
      auth_base: toRateOrNA(row[col["Authentication"]]),
      auth_intl_base: toRateOrNA(authIntlKey ? row[col[authIntlKey]] : "n/a"),
      service: toRateOrNA(row[col["Service"]]),
    };
  }

  return ratesMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 – Parse USD_volume_tiers.csv
// ─────────────────────────────────────────────────────────────────────────────

async function parseTiersCSV() {
  const rows = await readCSVRows(TIERS_CSV);

  // ── Find section start columns ──────────────────────────────────────────
  // There is a row that labels the three sections:
  //   col X  → "Utility"
  //   col Y  → "Authentication"
  //   col Z  → "Authentication-International"
  // We use this row to locate each section's starting column, making the
  // script resilient to sections being shifted left/right in future CSVs.
  const sectionRow = rows.find((row) =>
    row.some((cell) => normalizeHeader(cell).toLowerCase() === "utility")
  );
  if (!sectionRow) throw new Error("Could not find section-label row in USD_volume_tiers.csv");

  const normalised = sectionRow.map(normalizeHeader);

  const utilityStart = normalised.findIndex(
    (h) => h.toLowerCase() === "utility"
  );
  // "Authentication" appears twice (Authentication and Authentication-International);
  // take the first occurrence for the plain Authentication section.
  const authStart = normalised.findIndex(
    (h) => h.toLowerCase() === "authentication"
  );
  const intlStart = normalised.findIndex(
    (h) => h.toLowerCase().includes("authentication") && h.toLowerCase().includes("international")
  );

  // Each section has 5 columns: From | To | Rate type | Rate | vs. List rate
  // Offsets:                      +0     +1   +2          +3    +4

  // ── Find the data header row (contains "Currency" + "From") ─────────────
  const dataHeaderIdx = rows.findIndex(
    (row) =>
      normalizeHeader(row[1]) === "Currency" &&
      normalizeHeader(row[2]) === "From"
  );
  if (dataHeaderIdx === -1) throw new Error("Could not find data header row in USD_volume_tiers.csv");

  // ── Iterate data rows ───────────────────────────────────────────────────
  const tiersMap = {};
  let currentMarket = null;

  for (const row of rows.slice(dataHeaderIdx + 1)) {
    // A non-empty first cell marks the start of a new market block
    if (row[0] && row[0].trim() !== "") {
      currentMarket = row[0].trim();
      tiersMap[currentMarket] = { utility: [], authentication: [], auth_intl: [] };
    }
    if (!currentMarket) continue;

    // — Utility tier —
    if (utilityStart >= 0) {
      const tier = buildTier(
        row[utilityStart],
        row[utilityStart + 1],
        row[utilityStart + 2],
        row[utilityStart + 3],
        row[utilityStart + 4]
      );
      if (tier) tiersMap[currentMarket].utility.push(tier);
    }

    // — Authentication tier —
    if (authStart >= 0) {
      const tier = buildTier(
        row[authStart],
        row[authStart + 1],
        row[authStart + 2],
        row[authStart + 3],
        row[authStart + 4]
      );
      if (tier) tiersMap[currentMarket].authentication.push(tier);
    }

    // — Authentication-International tier (only when section exists & row is not n/a) —
    if (intlStart >= 0) {
      const fromCell = (row[intlStart] || "").trim();
      if (fromCell && fromCell.toLowerCase() !== "n/a") {
        const tier = buildTier(
          fromCell,
          row[intlStart + 1],
          row[intlStart + 2],
          row[intlStart + 3],
          row[intlStart + 4]
        );
        if (tier) tiersMap[currentMarket].auth_intl.push(tier);
      }
    }
  }

  return tiersMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 – Assemble and write JSON
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Reading CSV files…");
  const [ratesMap, tiersMap] = await Promise.all([
    parseRatesCSV(),
    parseTiersCSV(),
  ]);

  const result = Object.entries(ratesMap).map(([market, rates]) => {
    const tiers = tiersMap[market] || { utility: [], authentication: [], auth_intl: [] };
    const hasAuthIntl = rates.auth_intl_base !== "N/A";

    return {
      Market: market,
      Currency: rates.currency,
      Marketing: rates.marketing,

      Utility: {
        base_rate: rates.utility_base,
        tiers: tiers.utility,
      },

      Authentication: {
        base_rate: rates.auth_base,
        tiers: tiers.authentication,
      },

      Service: rates.service,

      // "N/A" when the market has no international auth rates,
      // otherwise an object with base_rate + tiers (same shape as the others)
      Authentication_International: hasAuthIntl
        ? { base_rate: rates.auth_intl_base, tiers: tiers.auth_intl }
        : "N/A",
    };
  });

  fs.mkdirSync(PUBLIC, { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(result, null, 2), "utf8");
  console.log(`✓ Wrote ${result.length} market entries → ${OUTPUT_JSON}`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
