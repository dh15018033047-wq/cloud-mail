import { connect } from 'cloudflare:sockets';

const CRLF = '\r\n';

function b64utf8(s) {
	const bytes = new TextEncoder().encode(s);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin);
}

async function readReply(reader) {
	const dec = new TextDecoder();
	let buf = '';
	for (;;) {
		const lines = buf.split(CRLF);
		for (let i = 0; i < lines.length - 1; i++) {
			if (/^\d{3} /.test(lines[i])) {
				return { code: parseInt(lines[i].slice(0, 3), 10), text: buf };
			}
		}
		const { value, done } = await reader.read();
		if (done) throw new Error('smtp connection closed: ' + buf.slice(-200));
		buf += dec.decode(value, { stream: true });
	}
}

async function expect(reader, writer, enc, sendText, want) {
	if (sendText !== null) await writer.write(enc.encode(sendText + CRLF));
	const r = await readReply(reader);
	if (r.code !== want) throw new Error(`smtp want ${want} got ${r.code}: ${r.text.slice(-160)}`);
}

async function smtpSend(env, to, subject, html) {
	const host = env.SMTP_HOST || 'smtp.qq.com';
	const port = Number(env.SMTP_PORT || 465);
	const sock = connect({ hostname: host, port }, { secureTransport: 'on' });
	const reader = sock.readable.getReader();
	const writer = sock.writable.getWriter();
	const enc = new TextEncoder();
	try {
		await expect(reader, writer, enc, null, 220);
		await expect(reader, writer, enc, 'EHLO velune.relay', 250);
		await expect(reader, writer, enc, 'AUTH LOGIN', 334);
		await expect(reader, writer, enc, btoa(env.SMTP_USER), 334);
		await expect(reader, writer, enc, btoa(env.SMTP_PASS), 235);
		await expect(reader, writer, enc, `MAIL FROM:<${env.SMTP_USER}>`, 250);
		await expect(reader, writer, enc, `RCPT TO:<${to}>`, 250);
		await expect(reader, writer, enc, 'DATA', 354);
		const msg =
			`From: =?UTF-8?B?${b64utf8('Velune')}?= <${env.SMTP_USER}>${CRLF}` +
			`To: <${to}>${CRLF}` +
			`Subject: =?UTF-8?B?${b64utf8(subject)}?=${CRLF}` +
			`MIME-Version: 1.0${CRLF}` +
			`Content-Type: text/html; charset="UTF-8"${CRLF}` +
			`Content-Transfer-Encoding: base64${CRLF}${CRLF}` +
			b64utf8(html);
		await expect(reader, writer, enc, msg + CRLF + '.', 250);
		await writer.write(enc.encode('QUIT' + CRLF));
	} finally {
		try { await sock.close(); } catch (_) {}
	}
}

export default {
	async fetch(req, env) {
		if (req.method === 'GET') return new Response('velune-mail-relay', { status: 200 });
		if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
		const auth = req.headers.get('authorization') || '';
		if (auth !== `Bearer ${env.RELAY_KEY}`) return new Response('denied', { status: 403 });
		let body;
		try { body = await req.json(); } catch (_) { return Response.json({ ok: false, error: 'bad json' }, { status: 400 }); }
		const { to, subject, html } = body || {};
		if (!to || !subject || !html) return Response.json({ ok: false, error: 'missing fields' }, { status: 400 });
		try {
			await smtpSend(env, to, subject, html);
			return Response.json({ ok: true });
		} catch (e) {
			return Response.json({ ok: false, error: String(e).slice(0, 300) }, { status: 502 });
		}
	},
};
