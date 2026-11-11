/* A scripted SMTP server behind a fake cloudflare:sockets connect(), for tests. */
export function fakeSmtp({ authOk = true, rcptCode = 250, greet = true } = {}){
  const enc = new TextEncoder(), dec = new TextDecoder();
  const commands = [], calls = [];
  let ctrl, pending = "", inData = false, data = "";
  const say = s => { try { ctrl.enqueue(enc.encode(s)); } catch (_){} };
  const readable = new ReadableStream({ start(c){ ctrl = c; } });
  const respond = line => {
    commands.push(line);
    const verb = line.split(" ")[0].toUpperCase();
    if (verb === "EHLO") say("250-smtp.test at your service\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 35882577\r\n");
    else if (verb === "AUTH") say(authOk ? "235 2.7.0 Accepted\r\n" : "535-5.7.8 Username and Password not accepted.\r\n535 5.7.8 Learn more\r\n");
    else if (line.startsWith("MAIL FROM:")) say("250 2.1.0 OK\r\n");
    else if (line.startsWith("RCPT TO:")) say(`${rcptCode} 2.1.5 OK\r\n`);
    else if (verb === "DATA"){ inData = true; say("354 Go ahead\r\n"); }
    else if (verb === "QUIT") say("221 2.0.0 closing connection\r\n");
    else say("502 5.5.1 Unrecognized command\r\n");
  };
  const writable = new WritableStream({
    write(chunk){
      pending += dec.decode(chunk);
      for (;;){
        if (inData){
          const end = pending.indexOf("\r\n.\r\n");
          if (end < 0 && !pending.startsWith(".\r\n")) return;
          const cut = end < 0 ? 3 : end + 5;
          data += pending.slice(0, cut);
          pending = pending.slice(cut);
          inData = false;
          say("250 2.0.0 OK 1731400000 abc123.1 - gsmtp\r\n");
          continue;
        }
        const i = pending.indexOf("\r\n");
        if (i < 0) return;
        const line = pending.slice(0, i);
        pending = pending.slice(i + 2);
        respond(line);
      }
    }
  });
  const socket = { readable, writable, closed: false, close(){ this.closed = true; try { ctrl.close(); } catch (_){} } };
  const connect = (address, options) => {
    calls.push({ address, options });
    if (greet) queueMicrotask(() => say("220 smtp.test ESMTP ready\r\n"));
    return socket;
  };
  return { connect, commands, calls, socket, data: () => data };
}

/* The parts of a MIME message, base64 bodies decoded. */
export function mimeParts(message){
  const [head, ...rest] = message.split("\r\n\r\n");
  const body = rest.join("\r\n\r\n");
  const boundary = /boundary="([^"]+)"/.exec(head)?.[1];
  const decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s+/g, "")), c => c.charCodeAt(0)));
  if (!boundary) return { head, parts: [{ type: /Content-Type: ([^;]+)/.exec(head)[1], body: decode(body.replace(/\r\n\.\r\n$/, "")) }] };
  const parts = body.split(`--${boundary}`).slice(1, -1).map(p => {
    const [h, ...b] = p.replace(/^\r\n/, "").split("\r\n\r\n");
    return { type: /Content-Type: ([^;]+)/.exec(h)[1], body: decode(b.join("")) };
  });
  return { head, parts };
}
