// src/utils/normalize.ts

/**
 * Normalize donor names for consistent database + MailWizz usage.
 *
 * Rules:
 * - Correct "Napoleon Kanaris" → "Napoleon Kanari"
 * - Couple: chriscasleton@gmail.com → "Catherine & Warren Casleton"
 * - Business: sportystn@bellsouth.net → "Sporty's Awards"
 * - Detect businesses containing tokens (Inc, LLC, Awards, Company, etc.)
 * - Case-normalize names like "maurice sherman" → "Maurice Sherman"
 * - Special: Daniel Holmes (always capitalized correctly)
 * - Special: Lacey Vann / Lacey Dione → "Lacey Dione"
 */
export function normalizeName(fullName: string, email: string) {
  if (!fullName) return { first: "", last: "" };

  const name = fullName.trim();

  // Hard-coded correction
  if (name.toLowerCase() === "napoleon kanaris") {
    return { first: "Napoleon", last: "Kanari" };
  }

  // Married couple special-case
  if (email.toLowerCase() === "chriscasleton@gmail.com") {
    return { first: "Catherine & Warren", last: "Casleton" };
  }

  // Business donor special-case
  if (email.toLowerCase() === "sportystn@bellsouth.net") {
    return { first: "Sporty's Awards", last: "" };
  }

  // Detect business tokens
  const businessTokens = [
    "awards",
    "inc",
    "llc",
    "company",
    "corp",
    "corporation",
    "enterprises",
    "group",
  ];
  if (businessTokens.some((tok) => name.toLowerCase().includes(tok))) {
    return { first: titleCase(name), last: "" };
  }

  // Default: split into first/last
  const tokens = name.split(" ");
  let first = tokens.length > 0 ? titleCase(tokens[0]) : "";
  let last =
    tokens.length > 1 ? titleCase(tokens[tokens.length - 1]) : "";

  // Daniel Holmes correction
  if (first.toLowerCase() === "daniel" && last.toLowerCase() === "holmes") {
    return { first: "Daniel", last: "Holmes" };
  }

  // Lacey merge
  if (
    first.toLowerCase() === "lacey" &&
    ["vann", "dione"].includes(last.toLowerCase())
  ) {
    return { first: "Lacey", last: "Dione" };
  }

  return { first, last };
}

/**
 * Title-case helper: capitalizes names properly
 * Handles hyphens and apostrophes.
 */
export function titleCase(s: string): string {
  if (!s) return s;
  return s
    .split(" ")
    .map((part) =>
      part
        .split("-")
        .map((seg) =>
          seg
            .split("'")
            .map(
              (piece) =>
                piece.charAt(0).toUpperCase() +
                piece.slice(1).toLowerCase()
            )
            .join("'")
        )
        .join("-")
    )
    .join(" ");
}

