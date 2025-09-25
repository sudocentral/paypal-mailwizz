#!/usr/bin/env python3
import os
import csv
import json
import argparse
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Set

import psycopg2
from psycopg2.extras import execute_batch
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
TOOLS_DIR = Path(__file__).resolve().parent

# 1) Load .env from project root
load_dotenv(dotenv_path=PROJECT_ROOT / ".env")

# 2) Require env vars (no silent defaults)
REQUIRED_ENV = ["POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASS", "POSTGRES_HOST"]
missing = [k for k in REQUIRED_ENV if not os.getenv(k)]
if missing:
    raise SystemExit(f"❌ Missing required env vars in .env: {', '.join(missing)}")

DB_NAME = os.getenv("POSTGRES_DB")
DB_USER = os.getenv("POSTGRES_USER")
DB_PASS = os.getenv("POSTGRES_PASS")
DB_HOST = os.getenv("POSTGRES_HOST")

# Special mappings
MERGE_EMAIL = "sleepstolong2@gmail.com"
MONASTERY_EMAIL = "info@monteaglemonastery.org"

# CSV columns we expect (PayPal exports sometimes vary slightly by locale/version)
COL_DATE = "Date"
COL_TIME = "Time"  # may or may not exist
COL_NAME = "Name"
COL_EMAIL = "From Email Address"
COL_GROSS = "Gross"
COL_TXN_ID = "Transaction ID"  # may or may not exist

def smart_title(s: str) -> str:
    """Normalize capitalization: always Title Case each token, preserving apostrophes/hyphens."""
    if not s:
        return s
    parts = s.split(" ")
    out = []
    for p in parts:
        # Handle apostrophes and hyphens
        sub = [seg.capitalize() for seg in p.split("-")]
        sub = ["'".join([r.capitalize() for r in seg.split("'")]) for seg in sub]
        out.append("-".join(sub))
    return " ".join(out)

def normalize_name(full_name: str, email: str = "") -> Tuple[str, str]:
    """Return (first_name, last_name). Apply corrections, couple merge, business handling, and special cases."""
    if not full_name:
        return ("", "")

    name = full_name.strip()

    # Hard-coded correction: Napoleon Kanaris -> Kanari
    if name.lower() in {"napoleon kanaris", "napoleon  kanaris"}:
        return ("Napoleon", "Kanari")

    # Married couple special-case: Catherine & Warren Casleton
    if email.lower() == "chriscasleton@gmail.com":
        return ("Catherine & Warren", "Casleton")

    # Business donor special-case: Sporty's Awards
    if email.lower() == "sportystn@bellsouth.net":
        return ("Sporty's Awards", "")

    # Detect business-style donors (fallback for other cases)
    business_tokens = {"awards", "inc", "llc", "company", "corp", "corporation", "enterprises", "group"}
    if any(tok in name.lower() for tok in business_tokens):
        return (smart_title(name), "")

    # Default: split into first/last
    tokens = name.split()
    first = smart_title(tokens[0])
    last = smart_title(tokens[-1]) if len(tokens) > 1 else ""

    # Handle Daniel Holmes case normalization
    if first.lower() == "daniel" and last.lower() == "holmes":
        return ("Daniel", "Holmes")

    # Special merge (Lacey rule)
    if first.lower() == "lacey" and last.lower() in {"vann", "dione"}:
        return ("Lacey", "Dione")

    return (first, last)


def parse_date(row: Dict[str, str]) -> datetime:
    """Parse date (and optional time) from PayPal CSV."""
    date_str = (row.get(COL_DATE) or "").strip()
    time_str = (row.get(COL_TIME) or "").strip()
    # Try common PayPal formats
    # US CSVs often: mm/dd/yyyy (and 24h or 12h time not always provided)
    if date_str:
        for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%Y"):
            try:
                if time_str:
                    return datetime.strptime(f"{date_str} {time_str}", fmt)
                else:
                    return datetime.strptime(date_str, fmt)
            except ValueError:
                continue
    # Fallback: now
    return datetime.utcnow()


def parse_amount(gross: str) -> float:
    """Parse the Gross amount; skip rows that aren't valid positive donations."""
    if gross is None:
        raise ValueError("No gross")
    g = gross.replace(",", "").strip()
    # Some locales may use parentheses for negatives, or include currency symbols
    g = g.replace("$", "")
    if g.startswith("(") and g.endswith(")"):
        g = f"-{g[1:-1]}"
    val = float(g)
    return val


def load_rows_from_csv(path: Path) -> List[Dict]:
    print(f"📂 Reading {path.name}")
    rows = []
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Basic fields
            email = (row.get(COL_EMAIL) or "").strip()
            if not email:
                continue

            # Skip internal transfers (rule #2)
            if email.lower() == MONASTERY_EMAIL:
                continue

            # Amount (rule #1)
            try:
                amount = parse_amount(row.get(COL_GROSS))
            except Exception:
                continue
            if amount <= 0:
                # Only count positive incoming donations
                continue

            # Name (rules #3 & #4)
            first, last = normalize_name(row.get(COL_NAME) or "", email)

            # Special donor merge (rule #5)
            if first.lower() == "lacey" and last.lower() in {"vann", "dione"}:
                email = MERGE_EMAIL
                first, last = "Lacey", "Dione"

            donation_dt = parse_date(row)
            txn_id = (row.get(COL_TXN_ID) or "").strip()

            rows.append({
                "email": email,
                "first_name": first,
                "last_name": last,
                "amount": amount,
                "donation_date": donation_dt,
                "raw_email": (row.get(COL_EMAIL) or "").strip(),
                "txn_id": txn_id,
                "source": "csv_import",
            })
    return rows


def find_conflicting_names(rows: List[Dict]) -> Dict[str, Set[Tuple[str, str]]]:
    """Same email, multiple (first,last) names -> flag."""
    names_by_email: Dict[str, Set[Tuple[str, str]]] = {}
    for r in rows:
        key = r["email"].lower()
        names_by_email.setdefault(key, set()).add((r["first_name"], r["last_name"]))
    return {e: s for e, s in names_by_email.items() if len(s) > 1 and e != MERGE_EMAIL}


def dedupe_by_txn_id(rows: List[Dict]) -> List[Dict]:
    """If Transaction ID exists, dedupe on it across all files."""
    seen: Set[str] = set()
    out: List[Dict] = []
    have_txn_id = any(r["txn_id"] for r in rows)
    if not have_txn_id:
        print("⚠️  No Transaction ID column found in files; skipping dedup step.")
        return rows
    for r in rows:
        tid = r["txn_id"]
        if not tid:
            # If some rows missing txn_id, keep them (can't dedupe safely)
            out.append(r)
            continue
        if tid in seen:
            continue
        seen.add(tid)
        out.append(r)
    return out


def upsert_donations(conn, rows: List[Dict], dry_run: bool = False):
    cur = conn.cursor()

    # Upsert donors first
    donors = {}  # email -> (first,last)
    for r in rows:
        donors[r["email"]] = (r["first_name"], r["last_name"])

    if donors:
        print(f"👤 Upserting {len(donors)} donors …")
        for email, (first, last) in donors.items():
            # Married couple special-case: Catherine + Warren Casleton
            if email.lower() == "chriscasleton@gmail.com":
                first, last = "Catherine & Warren", "Casleton"

            if dry_run:
                print(f"   [DRY-RUN] Donor → {email} | First: {first} | Last: {last}")
                continue

            cur.execute(
                """
                INSERT INTO donors (email, first_name, last_name)
                VALUES (%s, %s, %s)
                ON CONFLICT (email) DO UPDATE SET
                  first_name = EXCLUDED.first_name,
                  last_name  = EXCLUDED.last_name
                """,
                (email, first, last),
            )

    # Insert donations
    print(f"🧾 Inserting {len(rows)} donations …")
    if dry_run:
        for r in rows:
            print(
                f"   [DRY-RUN] Donation → Email: {r['email']} | "
                f"Name: {r.get('first_name','')} {r.get('last_name','')} | "
                f"Date: {r['donation_date']} | Amount: {r['amount']} | Source: {r['source']}"
            )
        return  # skip actual DB work

    if rows:
        # Resolve donor_id for each email once
        cur.execute("SELECT id, email FROM donors")
        id_by_email = {e: i for i, e in cur.fetchall()}

        payload = []
        for r in rows:
            donor_id = id_by_email.get(r["email"])
            if donor_id is None:
                continue
            payload.append((
                donor_id,
                r["donation_date"],
                r["amount"],
                r["source"],
                r["raw_email"],
            ))

        execute_batch(
            cur,
            """
            INSERT INTO donations (donor_id, donation_date, amount, source, raw_email)
            VALUES (%s, %s, %s, %s, %s)
            """,
            payload,
            page_size=1000,
        )

        # Recompute lifetime totals in one shot
        cur.execute("""
            UPDATE donors d
            SET lifetime_donated = COALESCE((
                SELECT SUM(amount) FROM donations WHERE donor_id = d.id
            ), 0)
        """)

    conn.commit()
    cur.close()

def main():
    ap = argparse.ArgumentParser(description="Import PayPal CSV donations into Postgres.")
    ap.add_argument("--dry-run", action="store_true", help="Parse and validate only; no DB writes.")
    ap.add_argument("--force", action="store_true", help="Proceed even if name conflicts are found.")
    ap.add_argument("--glob", default="monastery-donations-*.CSV",
                    help="Glob to select CSV files (default: monastery-donations-*.CSV)")
    args = ap.parse_args()

    # Gather files
    files = sorted(TOOLS_DIR.glob(args.glob))
    if not files:
        raise SystemExit(f"❌ No files match {args.glob} in {TOOLS_DIR}")

    # Load all rows
    all_rows: List[Dict] = []
    for p in files:
        all_rows.extend(load_rows_from_csv(p))

    print(f"📊 Parsed {len(all_rows)} candidate donation rows before dedup/validation.")

    # Dedupe on Transaction ID if available
    all_rows = dedupe_by_txn_id(all_rows)
    print(f"🧹 {len(all_rows)} rows remain after dedup.")

    # Check for same-email/multiple-name conflicts (except for the Lacey merge email)
    conflicts = find_conflicting_names(all_rows)
    if conflicts:
        report_path = TOOLS_DIR / "conflicts_report.json"
        with report_path.open("w", encoding="utf-8") as f:
            json.dump(
                {email: sorted(list(names)) for email, names in conflicts.items()},
                f, indent=2, ensure_ascii=False
            )
        print(f"⚠️  Found {len(conflicts)} email(s) with multiple names. Wrote details to {report_path}")
        if not args.force:
            print("🛑 Refusing to import with conflicts present. Re-run with --force if reviewed/acceptable.")
            return

    # Connect DB
    conn = psycopg2.connect(dbname=DB_NAME, user=DB_USER, password=DB_PASS, host=DB_HOST)

    try:
        upsert_donations(conn, all_rows, dry_run=args.dry_run)
    finally:
        conn.close()

    if args.dry_run:
        print("✅ Dry run complete (no database changes).")
    else:
        print("✅ Import complete and lifetime totals updated.")


if __name__ == "__main__":
    main()

