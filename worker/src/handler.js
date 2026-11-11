/* The Worker's one endpoint: POST /emails, in Resend's request format, so the
   database's send_app_email (supabase/021, 022) can use it like Resend.

     Authorization: Bearer <EMAIL_WORKER_TOKEN>
     { "from": "Cricket.lk <x@gmail.com>", "to": ["someone@example.com"],
       "subject": "…", "html": "…", "text": "…" }

   → 200 { "id": "<uuid>" } once Gmail has accepted the email, else 4xx/5xx
   { "error": "…" }. Only the From *name* is taken from the request: the
   address is always the Gmail account (SMTP_USER), so the Worker can't be
   used to send as anyone else. One recipient per request, like 021. */

import { sendMail, cleanDisplayName } from "./smtp.js";

export const MAX_BODY = 300 * 1024;        // the request, in bytes
export const MAX_PART = 200 * 1024;        // html / text, in characters
export const MAX_SUBJECT = 200;
// No whitespace (so no CR/LF), no characters that could end a header or an
// SMTP path; a dotted domain.
const EMAIL_RE = /^[^\s@<>()",;:\\[\]]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function isEmail(s){
  return typeof s === "string" && s.length <= 254 && EMAIL_RE.test(s);
}

function json(status, body, headers = {}){
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/* Compares two secrets in constant time (hashing both first, so their
   lengths don't leak either). */
async function safeEqual(a, b){
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

/* What's wrong with a request body, or null. */
export function validateEmail(body){
  if (!body || typeof body !== "object" || Array.isArray(body)) return "The body must be a JSON object";
  const to = Array.isArray(body.to) ? body.to : [body.to];
  if (to.length !== 1) return "Send to exactly one address";
  if (!isEmail(to[0])) return "`to` isn't a valid email address";
  if (typeof body.subject !== "string" || !body.subject.trim()) return "`subject` is required";
  if (body.subject.length > MAX_SUBJECT) return `\`subject\` is longer than ${MAX_SUBJECT} characters`;
  if (/[\r\n]/.test(body.subject)) return "`subject` can't contain line breaks";
  const html = body.html, text = body.text;
  if (html != null && typeof html !== "string") return "`html` must be a string";
  if (text != null && typeof text !== "string") return "`text` must be a string";
  if (!html && !text) return "Give `html` or `text`";
  if ((html || "").length > MAX_PART || (text || "").length > MAX_PART) return "The email is too long";
  if (body.from != null && typeof body.from !== "string") return "`from` must be a string";
  return null;
}

/* "Name <addr>" → "Name"; anything else → the fallback. */
export function fromName(from, fallback){
  const m = typeof from === "string" ? /^\s*"?([^"<]*?)"?\s*<[^>]*>\s*$/.exec(from) : null;
  return cleanDisplayName(m ? m[1] : "", cleanDisplayName(fallback));
}

export async function handle(request, env, { connect, send = sendMail } = {}){
  const url = new URL(request.url);
  if (url.pathname !== "/emails") return json(404, { error: "Not found" });
  if (request.method !== "POST") return json(405, { error: "Use POST" }, { Allow: "POST" });

  // A short or missing token would make the endpoint guessable: refuse to run.
  if (!env.EMAIL_WORKER_TOKEN || env.EMAIL_WORKER_TOKEN.length < 32 || !env.SMTP_USER || !env.SMTP_PASS){
    return json(500, { error: "The email worker isn't set up (see worker/README.md)" });
  }
  if (env.SEND_LIMIT){
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.SEND_LIMIT.limit({ key: ip });
    if (!success) return json(429, { error: "Too many requests, try again in a minute" });
  }
  const auth = /^Bearer (.+)$/.exec(request.headers.get("Authorization") || "");
  if (!auth || !(await safeEqual(auth[1], env.EMAIL_WORKER_TOKEN))) return json(401, { error: "Unauthorized" });

  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return json(413, { error: "Request too large" });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY) return json(413, { error: "Request too large" });
  let body;
  try { body = JSON.parse(raw); } catch (_){ return json(400, { error: "The body isn't valid JSON" }); }
  const problem = validateEmail(body);
  if (problem) return json(400, { error: problem });

  const id = crypto.randomUUID();
  try {
    await send({
      connect,
      host: env.SMTP_HOST || "smtp.gmail.com",
      port: env.SMTP_PORT || 465,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      fromName: fromName(body.from, env.FROM_NAME || "Cricket.lk"),
      to: Array.isArray(body.to) ? body.to[0] : body.to,
      subject: body.subject.trim(),
      html: body.html || "",
      text: body.text || ""
    });
  } catch (err){
    // Logs never hold an address or any of the email: just what failed.
    console.log(JSON.stringify({ event: "send_failed", id, code: err && err.code || null }));
    return json(502, { error: String(err && err.message || err).slice(0, 300) });
  }
  console.log(JSON.stringify({ event: "sent", id }));
  return json(200, { id });
}
