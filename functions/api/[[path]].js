// Cloudflare Pages Function：将 /api/* 反向代理到独立后端（BACKEND_ORIGIN）
// 这样前端仍使用同源相对路径 /api，无需处理跨域；支付回调建议直接指向后端域名。
export async function onRequest(context) {
  const { request, env } = context;
  const origin = String(env.BACKEND_ORIGIN || "").replace(/\/+$/, "");
  if (!origin) {
    return new Response(JSON.stringify({ error: "后端地址未配置（BACKEND_ORIGIN）" }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const url = new URL(request.url);
  const target = origin + url.pathname + url.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ipcountry");
  const hasBody = !["GET", "HEAD"].includes(request.method);
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: "manual",
  });
  const outHeaders = new Headers(upstream.headers);
  outHeaders.delete("content-encoding");
  outHeaders.delete("content-length");
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}
