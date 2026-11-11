import { test } from "node:test";
import assert from "node:assert/strict";
import { sendMail, SmtpError, buildMessage, dotStuff, encodeHeader, cleanDisplayName } from "../src/smtp.js";
import { fakeSmtp, mimeParts } from "./fake-smtp.js";

const base = { host: "smtp.gmail.com", port: "465", user: "cricketlk.mail@gmail.com", pass: "abcd efgh ijkl mnop" };

test("sends one email: TLS on 465, the SMTP steps in order, From is the Gmail account", async () => {
  const s = fakeSmtp();
  const reply = await sendMail({ ...base, connect: s.connect, fromName: "Cricket.lk", to: "player@example.com",
    subject: "Your claim was approved", html: "<p>Hi</p>", text: "Hi" });
  assert.match(reply, /OK/);
  assert.deepEqual(s.calls[0].address, { hostname: "smtp.gmail.com", port: 465 });
  assert.equal(s.calls[0].options.secureTransport, "on");
  assert.deepEqual(s.commands.map(c => c.split(" ")[0]), ["EHLO", "AUTH", "MAIL", "RCPT", "DATA", "QUIT"]);
  assert.equal(s.commands[2], "MAIL FROM:<cricketlk.mail@gmail.com>");
  assert.equal(s.commands[3], "RCPT TO:<player@example.com>");
  assert.equal(atob(s.commands[1].split(" ")[2]), "\u0000cricketlk.mail@gmail.com\u0000abcd efgh ijkl mnop");
  const msg = s.data();
  assert.ok(msg.endsWith("\r\n.\r\n"), "DATA ends with CRLF . CRLF");
  const { head, parts } = mimeParts(msg);
  assert.match(head, /^From: "Cricket\.lk" <cricketlk\.mail@gmail\.com>$/m);
  assert.match(head, /^To: <player@example\.com>$/m);
  assert.match(head, /^Subject: Your claim was approved$/m);
  assert.deepEqual(parts.map(p => p.type), ["text/plain", "text/html"]);
  assert.equal(parts[0].body, "Hi");
  assert.equal(parts[1].body, "<p>Hi</p>");
  assert.ok(s.socket.closed, "the socket is closed afterwards");
});

test("a rejected sign-in fails with the server's reason, never the password", async () => {
  const s = fakeSmtp({ authOk: false });
  await assert.rejects(
    sendMail({ ...base, connect: s.connect, fromName: "Cricket.lk", to: "a@example.com", subject: "x", text: "y" }),
    err => {
      assert.ok(err instanceof SmtpError);
      assert.equal(err.code, 535);
      assert.match(err.message, /Username and Password not accepted/);
      assert.ok(!err.message.includes("abcd") && !err.message.includes(btoa("\u0000" + base.user)), "no credentials in the error");
      return true;
    });
  assert.ok(!s.commands.some(c => c.startsWith("MAIL")), "nothing is sent after a failed sign-in");
  assert.ok(s.socket.closed);
});

test("a refused recipient fails", async () => {
  const s = fakeSmtp({ rcptCode: 550 });
  await assert.rejects(sendMail({ ...base, connect: s.connect, fromName: "C", to: "a@example.com", subject: "x", text: "y" }),
    err => err.code === 550 && /RCPT TO failed/.test(err.message));
});

test("a server that never answers times out", async () => {
  const s = fakeSmtp({ greet: false });
  await assert.rejects(sendMail({ ...base, connect: s.connect, fromName: "C", to: "a@example.com", subject: "x", text: "y", timeoutMs: 50 }),
    /didn't answer within/);
  assert.ok(s.socket.closed);
});

test("dot-stuffing: a line starting with a dot gets another, and the message ends with a lone dot", () => {
  assert.equal(dotStuff(".a\r\nb\r\n.c\r\n"), "..a\r\nb\r\n..c\r\n.\r\n");
  assert.equal(dotStuff("a\nb"), "a\r\nb\r\n.\r\n");
});

test("non-ASCII subjects and names are encoded words that decode back", () => {
  const subject = "ආයුබෝවන් — Cricket.lk claim approved for Kusal Mendis";
  const enc = encodeHeader(subject);
  assert.ok(/^[\x20-\x7e\r\n]*$/.test(enc), "only ASCII in the header");
  const decoded = enc.split("\r\n ").map(w => /^=\?UTF-8\?B\?(.*)\?=$/.exec(w)[1])
    .map(b => Uint8Array.from(atob(b), c => c.charCodeAt(0)));
  const all = new Uint8Array(decoded.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of decoded){ all.set(a, o); o += a.length; }
  assert.equal(new TextDecoder().decode(all), subject);
  for (const w of enc.split("\r\n ")) assert.ok(w.length <= 75, "each encoded word is at most 75 characters");
  assert.equal(encodeHeader("Plain subject"), "Plain subject");
});

test("one part when only text (or only html) is given", () => {
  const { parts } = mimeParts(buildMessage({ fromName: "C", fromAddr: "a@gmail.com", to: "b@example.com", subject: "s", text: "only text" }));
  assert.deepEqual(parts, [{ type: "text/plain", body: "only text" }]);
  const h = mimeParts(buildMessage({ fromName: "C", fromAddr: "a@gmail.com", to: "b@example.com", subject: "s", html: "<b>x</b>" }));
  assert.deepEqual(h.parts, [{ type: "text/html", body: "<b>x</b>" }]);
});

test("a display name can't break out of the From header", () => {
  assert.equal(cleanDisplayName('Evil"\r\nBcc: <x@y.com>'), "EvilBcc: x@y.com");
  assert.equal(cleanDisplayName("   "), "Cricket.lk");
  assert.equal(cleanDisplayName("x".repeat(100)).length, 64);
});
