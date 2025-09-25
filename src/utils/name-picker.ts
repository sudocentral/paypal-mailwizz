export type DonorRow = {
  preferred_first_name: string | null;
  preferred_last_name: string | null;
  baptismal_name: string | null;          // full name in one field
  legal_first_name: string | null;
  legal_last_name: string | null;
};

function splitName(full?: string | null): { first?: string; last?: string } {
  if (!full) return {};
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/**
 * Preferred > Baptismal > Legal
 */
export function pickDisplayNames(d: DonorRow): { first: string; last: string; used: 'preferred' | 'baptismal' | 'legal' } {
  const legalFirst = (d.legal_first_name ?? '').trim();
  const legalLast = (d.legal_last_name ?? '').trim();

  // 1) Preferred wins (if either piece is present we’ll fill the other from legal)
  if ((d.preferred_first_name && d.preferred_first_name.trim()) || (d.preferred_last_name && d.preferred_last_name.trim())) {
    return {
      first: (d.preferred_first_name ?? legalFirst).trim(),
      last: (d.preferred_last_name ?? legalLast).trim(),
      used: 'preferred',
    };
  }

  // 2) Baptismal (split into first/last, fill any missing from legal)
  const bap = splitName(d.baptismal_name);
  if (bap.first || bap.last) {
    return {
      first: (bap.first ?? legalFirst).trim(),
      last: (bap.last ?? legalLast).trim(),
      used: 'baptismal',
    };
  }

  // 3) Legal
  return { first: legalFirst, last: legalLast, used: 'legal' };
}

