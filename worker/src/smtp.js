/* A minimal SMTP client for Cloudflare Workers' TCP sockets, enough to send
   one email through Gmail (smtp.gmail.com:465, implicit TLS, AUTH PLAIN with
   an app password). No dependencies. `connect` is passed in (the Worker
   passes cloudflare:sockets' connect; tests pass a fake), so this file runs
   under Node too. */

export class SmtpError extends Error {
  constructor(message, code = null){ super(message); this.name = "SmtpError"; this.code = code; }
}

const enc = new TextEncoder();

/* UTF-8 → base64, in 76-character lines (MIME body). */
export function base64Lines(str){
  const bytes = enc.encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const b64 = btoa(bin);
  return b64.match(/.{1,76}/g)?.join("\r\n") || "";
}

/* A header value: plain when it's printable ASCII, else RFC 2047 encoded
   words, each at most ~45 bytes of UTF-8 so a character is never split. */
export function encodeHeader(str){
  if (/^[\x20-\x7e]*$/.test(str)) return str;
  const words = [];
  let chunk = "", size = 0;
  for (const ch of str){
    const n = enc.encode(ch).length;
    if (size + n > 45 && chunk){ words.push(chunk); chunk = ""; size = 0; }
    chunk += ch; size += n;
  }
  if (chunk) words.push(chunk);
  return words.map(w => `=?UTF-8?B?${base64Lines(w).replace(/\r\n/g, "")}?=`).join("\r\n ");
}

/* The From display name: no CR/LF, quotes, angle brackets or backslashes
   (nothing that could end the header or the quoted string), at most 64. */
export function cleanDisplayName(name, fallback = "Cricket.lk"){
  const n = String(name || "").replace(/[\r\n"<>\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 64);
  return n || fallback;
}

function displayName(name){
  return /^[\x20-\x7e]*$/.test(name) ? `"${name}"` : encodeHeader(name);
}

/* The whole message (headers + body), CRLF line endings, not yet
   dot-stuffed. Every header value comes from the caller's checked input. */
export function buildMessage({ fromName, fromAddr, to, subject, html, text, date = new Date(), boundary }){
  const b = boundary || "b_" + crypto.randomUUID().replace(/-/g, "");
  const headers = [
    `From: ${displayName(fromName)} <${fromAddr}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    "MIME-Version: 1.0"
  ];
  const part = (type, body) => [
    `Content-Type: ${type}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(body)
  ].join("\r\n");
  let body;
  if (html && text){
    headers.push(`Content-Type: multipart/alternative; boundary="${b}"`);
    body = [`--${b}`, part("text/plain", text), `--${b}`, part("text/html", html), `--${b}--`, ""].join("\r\n");
  } else {
    const p = part(html ? "text/html" : "text/plain", html || text);
    const [ct, cte, , ...rest] = p.split("\r\n");
    headers.push(ct, cte);
    body = rest.join("\r\n") + "\r\n";
  }
  return headers.join("\r\n") + "\r\n\r\n" + body;
}

/* SMTP DATA: a line starting with "." gets another "." in front, and the
   message ends with CRLF . CRLF. */
export function dotStuff(message){
  const m = message.replace(/\r?\n/g, "\r\n");
  return m.replace(/(^|\r\n)\./g, "$1..") + (m.endsWith("\r\n") ? "" : "\r\n") + ".\r\n";
}

/* Reads SMTP replies: one or more lines, "250-…" continues, "250 …" ends. */
class ReplyReader {
  constructor(readable){ this.reader = readable.getReader(); this.buf = ""; this.dec = new TextDecoder(); }
  async line(){
    for (;;){
      const i = this.buf.indexOf("\n");
      if (i >= 0){
        const l = this.buf.slice(0, i).replace(/\r$/, "");
        this.buf = this.buf.slice(i + 1);
        return l;
      }
      const { value, done } = await this.reader.read();
      if (done) throw new SmtpError("The mail server closed the connection");
      this.buf += this.dec.decode(value, { stream: true });
    }
  }
  async reply(){
    const lines = [];
    for (;;){
      const l = await this.line();
      lines.push(l);
      if (!/^\d{3}-/.test(l)) break;
    }
    const last = lines[lines.length - 1];
    const code = parseInt(last.slice(0, 3), 10);
    if (!Number.isFinite(code)) throw new SmtpError("The mail server sent an unreadable reply");
    return { code, text: lines.map(l => l.slice(4)).join(" ").trim() };
  }
  release(){ try { this.reader.releaseLock(); } catch (_){} }
}

/* Sends one email. Resolves with the server's reply to the message (Gmail's
   includes its queue id); rejects with an SmtpError whose message is safe to
   return (it never contains the password: the AUTH line is never echoed). */
export async function sendMail(opts){
  const { connect, host, port, user, pass, timeoutMs = 20000 } = opts;
  let socket, timer;
  const work = (async () => {
    socket = connect({ hostname: host, port: Number(port) }, { secureTransport: "on", allowHalfOpen: false });
    const replies = new ReplyReader(socket.readable);
    const writer = socket.writable.getWriter();
    const send = s => writer.write(enc.encode(s));
    const expect = async (codes, step) => {
      const r = await replies.reply();
      if (!codes.includes(r.code)) throw new SmtpError(`${step} failed: ${r.code} ${r.text}`.slice(0, 300), r.code);
      return r;
    };
    try {
      await expect([220], "Connecting");
      await send(`EHLO cricket-lk-worker\r\n`);
      await expect([250], "EHLO");
      await send(`AUTH PLAIN ${btoa(`\u0000${user}\u0000${pass}`)}\r\n`);
      await expect([235], "Signing in to the mail server");
      await send(`MAIL FROM:<${user}>\r\n`);
      await expect([250], "MAIL FROM");
      await send(`RCPT TO:<${opts.to}>\r\n`);
      await expect([250, 251], "RCPT TO");
      await send("DATA\r\n");
      await expect([354], "DATA");
      await send(dotStuff(buildMessage({ ...opts, fromAddr: user })));
      const done = await expect([250], "Sending the message");
      await send("QUIT\r\n");
      try { await replies.reply(); } catch (_){} // 221; the email is already accepted
      return done.text;
    } finally {
      replies.release();
      try { writer.releaseLock(); } catch (_){}
    }
  })();
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new SmtpError(`The mail server didn't answer within ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    try { socket && socket.close(); } catch (_){}
    work.catch(() => {}); // a timed-out send can't reject unhandled later
  }
}
