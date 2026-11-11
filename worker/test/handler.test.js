import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, validateEmail, fromName, MAX_BODY } from "../src/handler.js";
import { SmtpError } from "../src/smtp.js";
import { fakeSmtp, mimeParts } from "./fake-smtp.js";

const TOKEN = "t".repeat(40);
const env = { EMAIL_WORKER_TOKEN: TOKEN, SMTP_USER: "cricketlk.mail@gmail.com", SMTP_PASS: "app pass word here", FROM_NAME: "Cricket.lk" };
const good = { from: "Cricket.lk <cricketlk.mail@gmail.com>", to: ["player@example.com"], subject: "Claim approved", html: "<p>Yes</p>", text: "Yes" };

function req(body, { token = TOKEN, method = "POST", path = "/emails", headers = {} } = {}){
  return new Request("https://cricket-lk-worker.example.workers.dev" + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined
  });
}
async function call(r, e = env, deps = {}){
  const res = await handle(r, e, deps);
  return { status: res.status, body: await res.json() };
}
const neverSend = () => { throw new Error("must not send"); };

test("only POST /emails", async () => {
  assert.equal((await call(req(good, { path: "/" }), env, { send: neverSend })).status, 404);
  assert.equal((await call(req(null, { method: "GET" }), env, { send: neverSend })).status, 405);
});

test("refuses to run without its secrets, or with a short token", async () => {
  assert.equal((await call(req(good), { ...env, SMTP_PASS: "" }, { send: neverSend })).status, 500);
  const short = { ...env, EMAIL_WORKER_TOKEN: "short" };
  assert.equal((await call(req(good, { token: "short" }), short, { send: neverSend })).status, 500);
});

test("needs the token", async () => {
  assert.equal((await call(req(good, { token: null }), env, { send: neverSend })).status, 401);
  assert.equal((await call(req(good, { token: "x".repeat(40) }), env, { send: neverSend })).status, 401);
  assert.equal((await call(req(good, { token: TOKEN + "x" }), env, { send: neverSend })).status, 401);
});

test("checks the request: JSON, one valid recipient, no header injection, a body", async () => {
  const bad = async (b, re) => {
    const r = await call(req(b), env, { send: neverSend });
    assert.equal(r.status, 400, JSON.stringify(b));
    if (re) assert.match(r.body.error, re);
  };
  await bad("{nope", /valid JSON/);
  await bad({ ...good, to: ["a@example.com", "b@example.com"] }, /exactly one/);
  await bad({ ...good, to: [] }, /exactly one/);
  await bad({ ...good, to: ["a@example.com\r\nBcc: victim@example.com"] }, /valid email/);
  await bad({ ...good, to: ["<a@example.com>"] }, /valid email/);
  await bad({ ...good, to: ["not-an-address"] }, /valid email/);
  await bad({ ...good, subject: "Hi\r\nBcc: victim@example.com" }, /line breaks/);
  await bad({ ...good, subject: "x".repeat(201) }, /longer/);
  await bad({ ...good, subject: "" }, /required/);
  await bad({ ...good, html: "", text: "" }, /html/);
  await bad({ ...good, html: 5 }, /string/);
  assert.equal(validateEmail({ ...good, to: "single@example.com" }), null, "a single string recipient is fine");
});

test("too large is refused before parsing", async () => {
  const big = { ...good, html: "x".repeat(MAX_BODY) };
  assert.equal((await call(req(big), env, { send: neverSend })).status, 413);
});

test("sends through Gmail: the From address is always the account, only the name comes from the request", async () => {
  const s = fakeSmtp();
  const r = await call(req({ ...good, from: "Cricket.lk <ceo@bank.example>" }), env, { connect: s.connect });
  assert.equal(r.status, 200);
  assert.match(r.body.id, /^[0-9a-f-]{36}$/);
  assert.equal(s.commands[2], "MAIL FROM:<cricketlk.mail@gmail.com>");
  assert.equal(s.commands[3], "RCPT TO:<player@example.com>");
  const { head, parts } = mimeParts(s.data());
  assert.match(head, /^From: "Cricket\.lk" <cricketlk\.mail@gmail\.com>$/m);
  assert.ok(!head.includes("bank.example"));
  assert.equal(parts[1].body, "<p>Yes</p>");
});

test("a send failure is a 502 with the reason, and the log has no addresses", async () => {
  const lines = [];
  const orig = console.log; console.log = (...a) => lines.push(a.join(" "));
  try {
    const r = await call(req(good), env, { send: async () => { throw new SmtpError("Signing in to the mail server failed: 535 Username and Password not accepted", 535); } });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /535/);
  } finally { console.log = orig; }
  assert.ok(lines.length && lines.every(l => !l.includes("@")), "no email address in the logs: " + lines.join(" | "));
});

test("the rate limit applies before anything else is read", async () => {
  const limited = { ...env, SEND_LIMIT: { limit: async () => ({ success: false }) } };
  assert.equal((await call(req(good), limited, { send: neverSend })).status, 429);
});

test("From name: taken from 'Name <addr>', cleaned, else the default", () => {
  assert.equal(fromName("Cricket.lk <x@y.com>", "D"), "Cricket.lk");
  assert.equal(fromName('"Quoted Name" <x@y.com>', "D"), "Quoted Name");
  assert.equal(fromName("x@y.com", "Cricket.lk"), "Cricket.lk");
  assert.equal(fromName(undefined, "Cricket.lk"), "Cricket.lk");
});
