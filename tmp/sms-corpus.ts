/**
 * Real-world Indian bank/UPI SMS formats used to validate the parser.
 * expect: 'debit' | 'credit' | 'skip'
 */
export interface Case {
  address: string;
  body: string;
  expect: 'debit' | 'credit' | 'skip';
  amount?: number;
  note?: string;
}

export const CASES: Case[] = [
  // ---------- HDFC ----------
  { address: 'AD-HDFCBK-S', expect: 'debit', amount: 400,
    body: 'Sent Rs.400.00 From HDFC Bank A/C *1590 To RAGHAV On 07/08/26 Ref 5222 Not You? Call 18002586161',
    note: 'USER REPORTED — currently dropped' },
  { address: 'VM-HDFCBK-S', expect: 'debit', amount: 7000,
    body: 'HDFC Bank:Rs. 7000.00 debited from a/c *1592 on 07-08-26 to VPA raghav@okhdfcbank. Ref 12345.' },
  { address: 'VM-HDFCBK', expect: 'credit', amount: 25000,
    body: 'Rs.25000.00 credited to HDFC Bank A/c XX1590 on 05-08-26 towards NEFT-SALARY. Avl bal Rs.61234.00' },
  { address: 'AD-HDFCBK', expect: 'debit', amount: 1299,
    body: 'Rs.1299.00 spent on HDFC Bank Card x1234 at AMAZON on 04-08-26. Avl Lmt Rs.48701. Not you? Call 18002586161' },

  // ---------- SBI ----------
  { address: 'AX-SBIINB-S', expect: 'debit', amount: 2500,
    body: 'Dear UPI user A/C X1234 debited by 2500.0 on date 06Aug26 trf to SWIGGY Refno 123456789. If not u? call 1800111109. -SBI' },
  { address: 'AX-SBIINB', expect: 'credit', amount: 50000,
    body: 'Dear Customer, Your A/c XX1234-credited by Rs.50000 on 01-08-26 by a/c linked to mobile 9XXXXX (IMPS Ref no 123). -SBI' },
  { address: 'CP-SBIUPI', expect: 'debit', amount: 149,
    body: 'Rs149.00 debited from A/cXX1234 on 03-08-26 to VPA zomato@ybl. Ref 987654. -SBI' },

  // ---------- ICICI ----------
  { address: 'JD-ICICIB-S', expect: 'debit', amount: 850,
    body: 'ICICI Bank Acct XX123 debited for Rs 850.00 on 05-Aug-26; UBER INDIA credited. UPI:123456789012. Call 18002662 for dispute.' },
  { address: 'JD-ICICIB', expect: 'credit', amount: 3200,
    body: 'Dear Customer, Acct XX123 is credited with Rs 3200.00 on 02-Aug-26 from RAHUL K. UPI:987654321. -ICICI Bank' },
  { address: 'VM-ICICIB', expect: 'debit', amount: 599,
    body: 'INR 599.00 spent using ICICI Bank Card XX1234 on 06-Aug-26 on NETFLIX. Avl Limit: INR 45,401.00' },

  // ---------- AXIS ----------
  { address: 'AD-AXISBK-S', expect: 'debit', amount: 1200,
    body: 'INR 1200.00 debited from A/c no. XX1234 on 06-08-26 at BIGBAZAAR. Avl Bal INR 23456.78. -Axis Bank' },
  { address: 'AD-AXISBK', expect: 'credit', amount: 15000,
    body: 'INR 15000.00 credited to A/c no. XX1234 on 01-08-26 (NEFT Cr-HDFC0000001-EMPLOYER-SALARY). Avl Bal INR 38456.78' },

  // ---------- KOTAK / YES / PNB / BOB / CANARA / IDFC ----------
  { address: 'VM-KOTAKB', expect: 'debit', amount: 349,
    body: 'Sent Rs.349.00 from Kotak Bank AC X1234 to swiggy@okicici on 05-08-26. UPI Ref 123456789012. Not you, kotak.com/fraud' },
  { address: 'AD-YESBNK', expect: 'debit', amount: 780,
    body: 'Your A/c XX1234 is debited by Rs.780.00 on 04-08-26 and credited to UBER (UPI Ref no 123456789012)-YES BANK' },
  { address: 'AD-PNBSMS', expect: 'debit', amount: 500,
    body: 'Rs.500.00 withdrawn from A/c XX1234 on 03-08-26 at ATM PNB MUMBAI. Avl Bal Rs.12345.00 -PNB' },
  { address: 'VM-BOBTXN', expect: 'debit', amount: 2100,
    body: 'Rs.2100.00 transferred from A/c XX1234 to RAMESH on 02-08-26. Total Bal Rs.9876.54 -Bank of Baroda' },
  { address: 'AD-CANBNK', expect: 'credit', amount: 4500,
    body: 'An amount of INR 4500.00 has been CREDITED to your account XX1234 on 01-08-26. Available balance INR 20000.00 -Canara Bank' },
  { address: 'AD-IDFCFB', expect: 'debit', amount: 99,
    body: 'INR 99.00 has been debited from your IDFC FIRST Bank Account XX1234 on 06-Aug-26 towards SPOTIFY. Bal: INR 5000.00' },

  // ---------- UPI apps ----------
  { address: 'VM-PAYTMB', expect: 'debit', amount: 250,
    body: 'Paid Rs.250 to Chai Point via Paytm UPI from A/c XX1234 on 06-08-26. UPI Ref 123456789012.' },
  { address: 'AD-PHONPE', expect: 'debit', amount: 1500,
    body: 'Rs.1500 paid to BigBasket from your account XX1234 via PhonePe UPI on 05-08-26. Txn ID T123456789.' },
  { address: 'VM-GPAYIN', expect: 'credit', amount: 200,
    body: 'You received Rs.200 from AMIT S in your A/c XX1234 via Google Pay UPI on 04-08-26.' },

  // ---------- Credit cards ----------
  { address: 'AD-SBICRD', expect: 'debit', amount: 3499,
    body: 'Rs.3499.00 has been charged on your SBI Credit Card ending 1234 at CROMA on 06-08-26.' },
  { address: 'VM-HDFCBK', expect: 'debit', amount: 720,
    body: 'Your HDFC Bank Credit Card xx1234 has been billed Rs.720.00 at SWIGGY on 05-08-26.' },
  { address: 'AD-AMEXIN', expect: 'debit', amount: 5600,
    body: 'Alert: You have made a transaction of INR 5,600.00 on your American Express Card ending 1005 at MYNTRA.' },

  // ---------- Tricky: BOTH debit and credit words present ----------
  { address: 'JD-ICICIB', expect: 'debit', amount: 640,
    body: 'ICICI Bank Acct XX123 debited for Rs 640.00; ZOMATO credited. UPI:123. Avl Bal Rs 4321.00',
    note: 'both words — must resolve to DEBIT' },
  { address: 'AD-YESBNK', expect: 'debit', amount: 300,
    body: 'A/c XX1234 debited by Rs.300.00 and credited to OLA CABS (UPI Ref 123)',
    note: 'both words — must resolve to DEBIT' },

  // ---------- FROM USER'S REAL INBOX (screenshots 2026-08-07) ----------
  { address: 'JD-BOBSMS-S', expect: 'debit', amount: 60,
    body: 'Rs.60.00 Dr. from A/C XXXXXX0315 and Cr. to paytm.s1234@pty on 05-08-26. Ref 123456. -Bank of Baroda',
    note: 'REAL — BoB "Dr./Cr." shorthand' },
  { address: 'JX-BOBSMS-S', expect: 'debit', amount: 50,
    body: 'Rs.50.00 Dr. from A/C XXXXXX0315 and Cr. to paytm.s5678@pty on 04-08-26. Ref 654321. -Bank of Baroda',
    note: 'REAL — same format, different sender prefix' },
  { address: 'JK-SBIUPI-S', expect: 'debit', amount: 150,
    body: 'Dear UPI user A/C X2668 debited by 150.00 on date 03Aug26 trf to MERCHANT Refno 123456789. -SBI',
    note: 'REAL — SBI UPI, sender is JK- not AX-' },

  // Real junk from the same inbox — every one of these must be skipped.
  { address: 'AD-SWISHN-S', expect: 'skip',
    body: '734954 is the OTP to log into Swish account. Do not share with anyone.',
    note: 'REAL — OTP' },
  { address: 'AX-SBLIFE-P', expect: 'skip',
    body: 'एसबीआई लाइफ इंश्योरेंस की ओर से आपको जन्मदिन की शुभकामनाएँ। आपका दिन शुभ हो।',
    note: 'REAL — insurance birthday wish, bank-like sender SBLIFE' },
  { address: 'JX-620014-P', expect: 'skip',
    body: 'आपके Jio नंबर 9251190329 के प्लान की वैधता समाप्त हो गयी है| रीचार्ज करें Rs.299 से',
    note: 'REAL — numeric sender, recharge promo with an amount' },
  { address: 'JM-PVRVIP-P', expect: 'skip',
    body: 'Thanks for booking with PVR! Enjoy exclusive EXTRA 10% OFF on your next booking. Use code PVR500.',
    note: 'REAL — promo, mentions a code that looks like an amount' },
  { address: 'AR-650025-P', expect: 'skip',
    body: 'Enjoy up to Rs.5,000 off at 70+ brands! Shop safely with your card.',
    note: 'REAL — promo with a large amount' },
  { address: 'JZ-JIOFBR-S', expect: 'skip',
    body: 'Dear Customer, Your JioHome bill dated 26-Jul-2026 for Rs.899 is now available. Pay by 05-Aug.',
    note: 'REAL — bill notice, not a payment' },
  { address: 'AD-INOXMV-S', expect: 'skip',
    body: 'Your INOX booking ref is 1015974. Enjoy the show!',
    note: 'REAL — booking confirmation, no amount' },
  { address: 'JK-620019-P', expect: 'skip',
    body: 'Plan expired! Recharge now and get 2GB/day at Rs.349 only.',
    note: 'REAL — numeric sender promo' },

  // ---------- Must be SKIPPED (no money moved) ----------
  { address: 'JK-DHANHQ-S', expect: 'skip',
    body: '574579 is your OTP for Dhan. Please do not share it with anyone.' },
  { address: 'JM-JIOMRT', expect: 'skip',
    body: 'You get 10% Cashback on your next bill on JioMart. Shop now and save Rs.500!' },
  { address: 'JX-NSEWEL-S', expect: 'skip',
    body: 'Dear AHVXXXXX0C Welcome to NSE, You have been registered successfully.' },
  { address: 'VM-HDFCBK', expect: 'skip',
    body: 'Your HDFC Bank A/c XX1234 balance is Rs.15234.56 as on 06-08-26.',
    note: 'balance enquiry — no transaction' },
  { address: 'AD-HDFCBK', expect: 'skip',
    body: 'Your OTP for HDFC Bank NetBanking txn of Rs.5000 is 123456. Do not share.',
    note: 'OTP mentioning an amount — must not become a transaction' },
  { address: 'AD-ICICIB', expect: 'skip',
    body: 'Your Credit Card bill of Rs.12345.00 is due on 15-08-26. Pay now to avoid charges.',
    note: 'bill reminder — not yet paid' },
];
