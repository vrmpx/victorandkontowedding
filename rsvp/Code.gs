/**
 * Wedding RSVP backend — Google Apps Script web app, bound to the RSVP spreadsheet.
 *
 * Tabs:
 *   Guests    — you maintain it. Columns: Code | Party | Guest
 *               One row per seat. Rows sharing a Party share a Code.
 *               Leave Guest blank for a plus-one seat (guest types the name).
 *               Leave Code blank and run generateCodes() to fill codes in.
 *   Responses — written by the script (auto-created). One row per seat.
 */

const CONFIG = {
  DEADLINE: '2027-01-31T23:59:59-06:00', // Mexico City time; set to your real cutoff
  SEND_CONFIRMATION: true,               // email a confirmation if the guest leaves an address
  FROM_NAME: 'Victor & Konto',
  EVENT: {
    es: 'el 20 de marzo de 2027 en el Claustro de Sor Juana',
    en: 'on March 20, 2027 at Claustro de Sor Juana',
  },
};

const GUESTS = 'Guests';
const RESPONSES = 'Responses';
const HEADERS = {
  [GUESTS]: ['Code', 'Party', 'Guest'],
  [RESPONSES]: ['Timestamp', 'Code', 'Party', 'Slot', 'Guest', 'Attending', 'Dietary', 'Message', 'Email', 'Lang'],
};

/* ---------- web app entry points ---------- */

function doGet() {
  return json_({ ok: true, status: 'alive' }); // open the /exec URL in a browser to check the deployment
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (req.website) return json_({ ok: true, attending: 0 }); // honeypot: bots fill hidden fields
    if (req.action === 'lookup') out = lookup_(req.code);
    else if (req.action === 'submit') out = submit_(req);
    else out = { ok: false, error: 'bad_action' };
  } catch (err) {
    console.error(err);
    out = { ok: false, error: 'server' };
  }
  return json_(out);
}

/* ---------- actions ---------- */

function lookup_(rawCode) {
  Utilities.sleep(400); // slows down code guessing
  const code = normCode_(rawCode);
  const party = code && party_(code);
  if (!party) return { ok: false, error: 'not_found' };
  return {
    ok: true,
    code: code,
    party: party.party,
    closed: isClosed_(),
    guests: party.guests.map((name, i) => ({ slot: i, name: name, open: !name })),
    previous: existing_(code),
  };
}

function submit_(req) {
  if (isClosed_()) return { ok: false, error: 'closed' };
  const code = normCode_(req.code);
  const party = code && party_(code);
  if (!party) return { ok: false, error: 'not_found' };

  const lang = req.lang === 'en' ? 'en' : 'es';
  const answers = Array.isArray(req.guests) ? req.guests : [];
  const message = clean_(req.message, 1000);
  const emailRaw = String(req.email || '').trim().slice(0, 200);
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : '';
  const now = new Date();

  const rows = party.guests.map((fixedName, i) => {
    const a = answers.find(x => Number(x.slot) === i) || {};
    const attending = a.attending === true || a.attending === 'yes';
    const name = fixedName || clean_(a.name, 100) || (lang === 'en' ? 'Plus-one' : 'Acompañante');
    return [now, code, party.party, i, name, attending ? 'yes' : 'no',
            attending ? clean_(a.dietary, 300) : '', message, email, lang];
  });

  let updated = false;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_(RESPONSES);
    const vals = sh.getDataRange().getValues();
    for (let r = vals.length - 1; r >= 1; r--) {           // replace any earlier answer for this code
      if (normCode_(vals[r][1]) === code) { sh.deleteRow(r + 1); updated = true; }
    }
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  } finally {
    lock.releaseLock();
  }

  if (CONFIG.SEND_CONFIRMATION && email) {
    try { sendConfirmation_(email, lang, party.party, rows); } catch (err) { console.error(err); }
  }
  return { ok: true, updated: updated, attending: rows.filter(r => r[5] === 'yes').length };
}

/* ---------- helpers ---------- */

function party_(code) {
  const rows = sheet_(GUESTS).getDataRange().getValues().slice(1)
    .filter(r => normCode_(r[0]) === code);
  if (!rows.length) return null;
  return { party: String(rows[0][1]).trim(), guests: rows.map(r => String(r[2] || '').trim()) };
}

function existing_(code) {
  const rows = sheet_(RESPONSES).getDataRange().getValues().slice(1)
    .filter(r => normCode_(r[1]) === code);
  if (!rows.length) return null;
  return {
    guests: rows.map(r => ({ slot: Number(r[3]), name: String(r[4]), attending: r[5] === 'yes', dietary: String(r[6] || '') })),
    message: String(rows[0][7] || ''),
    email: String(rows[0][8] || ''),
  };
}

function sendConfirmation_(email, lang, party, rows) {
  const yes = rows.filter(r => r[5] === 'yes').map(r => r[4]);
  const es = lang === 'es';
  const subject = es ? 'Recibimos tu confirmación' : 'We got your RSVP';
  const body = es
    ? `Hola, ${party}:\n\n` +
      (yes.length ? `Confirmados: ${yes.join(', ')}.\n\nNos vemos ${CONFIG.EVENT.es}.`
                  : 'Gracias por avisarnos. Te vamos a extrañar.') +
      `\n\nSi necesitas cambiar algo, vuelve a usar tu código en el sitio.\n\n${CONFIG.FROM_NAME}`
    : `Hi ${party},\n\n` +
      (yes.length ? `Confirmed: ${yes.join(', ')}.\n\nSee you ${CONFIG.EVENT.en}.`
                  : "Thanks for letting us know. We'll miss you.") +
      `\n\nIf anything changes, just use your code on the site again.\n\n${CONFIG.FROM_NAME}`;
  MailApp.sendEmail({ to: email, subject: subject, body: body, name: CONFIG.FROM_NAME });
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(HEADERS[name]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function isClosed_() { return new Date() > new Date(CONFIG.DEADLINE); }

function normCode_(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function clean_(v, max) {
  let s = String(v == null ? '' : v).trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // block spreadsheet formula injection
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- run manually from the editor ---------- */

/** Fills blank Code cells: one unique 6-char code per Party. */
function generateCodes() {
  const sh = sheet_(GUESTS);
  const data = sh.getDataRange().getValues();
  const used = new Set();
  const byParty = {};
  data.slice(1).forEach(r => {
    const c = normCode_(r[0]);
    if (c) { used.add(c); byParty[String(r[1]).trim()] = c; }
  });
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
  for (let i = 1; i < data.length; i++) {
    const party = String(data[i][1]).trim();
    if (!party || data[i][0]) continue;
    if (!byParty[party]) {
      let c;
      do { c = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(''); }
      while (used.has(c));
      used.add(c);
      byParty[party] = c;
    }
    sh.getRange(i + 1, 1).setValue(byParty[party]);
  }
}
