import { parseSmsToTransactions } from '../lib/parse-sms';
import { CASES } from './sms-corpus';

let pass = 0;
const fails: string[] = [];

CASES.forEach((c, i) => {
  const out = parseSmsToTransactions([
    { _id: String(i), address: c.address, date: Date.now(), body: c.body },
  ]);
  const got = out.length === 0 ? 'skip' : out[0].isDebit ? 'debit' : 'credit';
  const amt = out.length ? out[0].amount : undefined;
  const merch = out.length ? out[0].merchant : '';

  const dirOk = got === c.expect;
  const amtOk = c.expect === 'skip' || c.amount == null || amt === c.amount;

  if (dirOk && amtOk) {
    pass++;
  } else {
    fails.push(
      `[${c.address}] want=${c.expect}${c.amount ? '/' + c.amount : ''}  got=${got}${amt != null ? '/' + amt : ''}` +
        (merch ? `  merchant="${merch}"` : '') +
        `\n     "${c.body.slice(0, 78)}"` +
        (c.note ? `\n     note: ${c.note}` : '')
    );
  }
});

console.log(`\n=== ${pass}/${CASES.length} passed, ${fails.length} failed ===\n`);
fails.forEach((f) => console.log('FAIL ' + f + '\n'));
