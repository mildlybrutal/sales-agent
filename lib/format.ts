/** ₹ formatting in Indian units (lakh / crore). Safe for client and server. */
export function formatINR(amount: number | null | undefined): string {
  if (amount == null) return "—";
  if (amount >= 10_000_000) {
    const cr = amount / 10_000_000;
    return `₹${trim(cr)} Cr`;
  }
  if (amount >= 100_000) {
    return `₹${trim(amount / 100_000)} L`;
  }
  return `₹${amount.toLocaleString("en-IN")}`;
}

function trim(n: number) {
  return n.toFixed(2).replace(/\.?0+$/, "");
}

export function formatDuration(sec: number | null | undefined) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}
