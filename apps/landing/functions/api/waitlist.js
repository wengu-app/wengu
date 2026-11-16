// Cloudflare Pages Function: POST /api/waitlist
// 需要在 Pages 项目里绑定一个名为 WAITLIST 的 KV 命名空间。
// 每个邮箱存成一个键，重复提交只会覆盖，不会重复。

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost({ request, env }) {
  let email = "";
  try {
    const body = await request.json();
    email = String(body?.email ?? "").trim().toLowerCase();
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ error: "invalid_email" }, 400);
  }

  await env.WAITLIST.put(
    `email:${email}`,
    JSON.stringify({ email, joinedAt: new Date().toISOString() }),
  );
  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
