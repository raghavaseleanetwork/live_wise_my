import { parseSmsToTransactions } from '../lib/parse-sms';

/** Banks deliberately NOT in BANK_ENTITY_CODES — these must still work. */
const cases = [
  { address: 'AD-SHMRAO-S', body: 'Rs.450.00 debited from A/c XX7788 on 06-08-26 to VPA kirana@ybl. Ref 998877. -Shamrao Vithal Bank' },
  { address: 'VM-ZZQBNK-T', body: 'INR 1200.00 has been debited from your Account XXXX4321 on 05-Aug-26 towards GROCERY STORE.' },
  { address: 'JD-NEWFIN-S', body: 'Rs.75.00 Dr. from A/C XXXXXX1122 and Cr. to shop@paytm on 04-08-26. Ref 445566.' },
  { address: '9876543210',  body: 'Rs.300.00 debited from A/c XX9999 on 03-08-26 to VPA test@upi. Ref 112233.' },
  // Must still be rejected: unknown sender, promo body.
  { address: 'AD-NEWSHP-P', body: 'Flat Rs.2000 off on your next order! Shop now at NewShop.' },
  { address: 'VM-LOANXX-P', body: 'Get instant loan up to Rs.500000. Apply now, minimal documents!' },
];

cases.forEach((c, i) => {
  const out = parseSmsToTransactions([{ _id: String(i), address: c.address, date: Date.now(), body: c.body }]);
  const got = out.length ? `${out[0].isDebit ? '-' : '+'}${out[0].amount} ${out[0].merchant}` : 'SKIPPED';
  console.log(`${c.address.padEnd(14)} => ${got}`);
});
