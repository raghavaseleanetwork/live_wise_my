import { categorizeMerchantPublic } from '../lib/parse-sms';
import { CAT_CASES } from './cat-corpus';

let pass = 0;
const fails: string[] = [];

for (const c of CAT_CASES) {
  const got = categorizeMerchantPublic(c.merchant);
  if (got === c.expect) pass++;
  else fails.push(`${c.merchant.padEnd(22)} want=${c.expect.padEnd(14)} got=${got}${c.note ? '   (' + c.note + ')' : ''}`);
}

console.log(`\n=== ${pass}/${CAT_CASES.length} correct, ${fails.length} wrong ===\n`);
fails.forEach((f) => console.log('FAIL ' + f));

const others = CAT_CASES.filter((c) => categorizeMerchantPublic(c.merchant) === 'others').length;
console.log(`\n"others" rate: ${others}/${CAT_CASES.length} (${Math.round((others / CAT_CASES.length) * 100)}%)`);
