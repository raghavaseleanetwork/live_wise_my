import { classifySender, shouldParseSender } from '../lib/sms-sender';
import { CASES } from './sms-corpus';

console.log('=== SENDER VERDICTS ===\n');
const rows = CASES.map((c) => ({
  addr: c.address,
  verdict: classifySender(c.address),
  allowed: shouldParseSender(c.address, c.body),
  expect: c.expect,
}));

// The failure that matters most: a real transaction blocked by the sender gate.
const wronglyBlocked = rows.filter((r) => r.expect !== 'skip' && !r.allowed);
const junkAllowedThrough = rows.filter((r) => r.expect === 'skip' && r.allowed);

for (const r of rows) {
  const flag = r.expect !== 'skip' && !r.allowed ? '  <-- REAL TXN BLOCKED!' : '';
  console.log(
    `${r.addr.padEnd(14)} ${r.verdict.padEnd(8)} allowed=${String(r.allowed).padEnd(5)} want=${r.expect}${flag}`
  );
}

console.log(`\nReal transactions blocked by sender gate : ${wronglyBlocked.length}  (must be 0)`);
console.log(`Junk passing sender gate (keywords catch): ${junkAllowedThrough.length}`);
junkAllowedThrough.forEach((r) => console.log(`   still-allowed: ${r.addr}`));
