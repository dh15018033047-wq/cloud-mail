// velune-dl: GitHub Releases 下载加速(CF 边缘网络代理,国内可达)
// GET /<tag>/<file> → github releases download 流式转发
const UPSTREAM = 'https://github.com/dh15018033047-wq/velune-releases/releases/download/';

export default {
	async fetch(req) {
		const u = new URL(req.url);
		if (req.method === 'GET' && u.pathname === '/') {
			return new Response('velune-dl', { status: 200 });
		}
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			return new Response('method not allowed', { status: 405 });
		}
		const path = u.pathname.replace(/^\/+/, '');
		// 只允许 release 文件名形态,防开放代理滥用
		if (!/^v[\w.\-]+\/[\w.\-]+$/.test(path)) {
			return new Response('bad path', { status: 400 });
		}
		const upstream = await fetch(UPSTREAM + path, {
			method: req.method,
			redirect: 'follow',
			headers: { 'User-Agent': 'velune-dl/1.0' },
		});
		const h = new Headers(upstream.headers);
		h.set('Cache-Control', 'public, max-age=3600');
		return new Response(upstream.body, { status: upstream.status, headers: h });
	},
};
