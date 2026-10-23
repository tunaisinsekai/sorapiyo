// Cloudflare Worker: 一言の保存 + 管理ログイン（Google OAuth ＋ パスキー）
//
// 【必要な設定】Workers ダッシュボード
//   Bindings : KV namespace を変数名 HITOKOTO で紐づける
//   Secret   : GOOGLE_CLIENT_SECRET … Google OAuth のクライアントシークレット
//   Text     : GOOGLE_CLIENT_ID     … Google OAuth のクライアントID
//   Text     : ALLOWED_EMAIL        … 管理者として入れるGoogleアカウントのメールアドレス（複数ならカンマ区切り 例 a@gmail.com,b@gmail.com）
//   Secret   : TURNSTILE_SECRET     … (bot認証を使う場合) Turnstile のシークレットキー
//   Text     : ALLOWED_ORIGIN       … サイトのURL 例 https://xxxx.pages.dev（末尾の / なし）
// Google側の「承認済みのリダイレクトURI」には  このWorkerのURL + /auth/callback  を登録する。
//
// ログインの流れ:
//   Googleログイン → (パスキー登録済みなら) パスキー認証 → 管理ページに入れる
//   パスキーが1つも登録されていなければ、Googleログインだけで入れる（管理ページから追加できる）

const EMPTY = { text: "", updatedAt: null, history: [] };
const SESSION_TTL = 3600;     // ログインの有効時間（秒）
const PRE_TTL = 300;          // Googleログイン後、パスキー認証までの猶予（秒）
const MAX_FAILS = 5;          // 失敗の許容回数（IPごと）
const BLOCK_SECONDS = 600;    // 超えた時のブロック時間

// ---------- 小さな道具 ----------
const b64u = {
  enc(buf) {
    const b = new Uint8Array(buf); let s = "";
    for (const c of b) s += String.fromCharCode(c);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  dec(str) {
    str = String(str).replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    const bin = atob(str), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  },
};
const rand = (n = 32) => b64u.enc(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (d) => new Uint8Array(await crypto.subtle.digest("SHA-256", d));
const eqBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

async function safeEqualStr(a, b) {
  const te = new TextEncoder();
  const [ha, hb] = await Promise.all([sha256(te.encode(a)), sha256(te.encode(b))]);
  return eqBytes(ha, hb);
}

// ---------- 最小のCBORデコーダ（パスキー登録の読み取り用） ----------
function cborDecode(u, o = 0) {
  const ib = u[o++], mt = ib >> 5, ai = ib & 31;
  let val;
  if (ai < 24) val = ai;
  else if (ai === 24) { val = u[o++]; }
  else if (ai === 25) { val = (u[o] << 8) | u[o + 1]; o += 2; }
  else if (ai === 26) { val = ((u[o] << 24) >>> 0) + (u[o + 1] << 16) + (u[o + 2] << 8) + u[o + 3]; o += 4; }
  else throw new Error("cbor");
  switch (mt) {
    case 0: return [val, o];
    case 1: return [-1 - val, o];
    case 2: return [u.slice(o, o + val), o + val];
    case 3: return [new TextDecoder().decode(u.slice(o, o + val)), o + val];
    case 4: { const a = []; for (let i = 0; i < val; i++) { const [v, n] = cborDecode(u, o); a.push(v); o = n; } return [a, o]; }
    case 5: { const m = new Map(); for (let i = 0; i < val; i++) { const [k, n1] = cborDecode(u, o); const [v, n2] = cborDecode(u, n1); m.set(k, v); o = n2; } return [m, o]; }
    case 7: return [ai === 20 ? false : ai === 21 ? true : null, o];
    default: throw new Error("cbor");
  }
}

function derToRaw(d) {
  let o = 2;
  if (d[1] & 0x80) o = 2 + (d[1] & 0x7f);
  const rl = d[o + 1], r = d.slice(o + 2, o + 2 + rl); o = o + 2 + rl;
  const sl = d[o + 1], s = d.slice(o + 2, o + 2 + sl);
  const fix = (x) => { while (x.length > 32 && x[0] === 0) x = x.slice(1); const out = new Uint8Array(32); out.set(x, 32 - x.length); return out; };
  const raw = new Uint8Array(64); raw.set(fix(r), 0); raw.set(fix(s), 32);
  return raw;
}

function parseAuthData(ad) {
  return { rpIdHash: ad.slice(0, 32), flags: ad[32] };
}

function checkClientData(cdjBytes, type, challenge, origin) {
  const cd = JSON.parse(new TextDecoder().decode(cdjBytes));
  return cd.type === type && cd.challenge === challenge && cd.origin === origin;
}

// ---------- 本体 ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const allowed = env.ALLOWED_ORIGIN || "";
    const cors = {
      "Access-Control-Allow-Origin": allowed || "null",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Vary": "Origin",
    };
    const hdr = { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: hdr });
    const redirectToAdmin = (frag) => new Response(null, { status: 302, headers: { Location: allowed + "/admin.html#" + frag, "Cache-Control": "no-store" } });

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (!allowed || !env.HITOKOTO) return json({ error: "server not configured" }, 500);

    const ip = req.headers.get("CF-Connecting-IP") || "unknown";
    const failKey = "fail:" + ip;
    const isBlocked = async () => (Number(await env.HITOKOTO.get(failKey)) || 0) >= MAX_FAILS;
    const addFail = async () => env.HITOKOTO.put(failKey, String((Number(await env.HITOKOTO.get(failKey)) || 0) + 1), { expirationTtl: BLOCK_SECONDS });

    const rpId = new URL(allowed).hostname;
    const getPasskeys = async () => { try { return JSON.parse((await env.HITOKOTO.get("passkeys")) || "[]"); } catch (e) { return []; } };
    const newSession = async () => { const t = rand(32); await env.HITOKOTO.put("sess:" + t, "1", { expirationTtl: SESSION_TTL }); return t; };
    const bearer = () => { const m = (req.headers.get("Authorization") || "").match(/^Bearer (.+)$/); return m ? m[1] : null; };
    const isLoggedIn = async () => { const t = bearer(); return !!t && !!(await env.HITOKOTO.get("sess:" + t)); };

    try {
      // ===== 一言の読み取り（誰でも） =====
      if (req.method === "GET" && url.pathname === "/") {
        const v = await env.HITOKOTO.get("data");
        return new Response(v || JSON.stringify(EMPTY), { headers: hdr });
      }

      // ===== Googleログイン開始 =====
      if (req.method === "GET" && url.pathname === "/auth/start") {
        if (await isBlocked()) return redirectToAdmin("error=blocked");
        const state = rand(24);
        await env.HITOKOTO.put("state:" + state, "1", { expirationTtl: 600 });
        const g = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        g.search = new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          redirect_uri: url.origin + "/auth/callback",
          response_type: "code",
          scope: "openid email",
          state,
          prompt: "select_account",
        }).toString();
        return new Response(null, { status: 302, headers: { Location: g.toString(), "Cache-Control": "no-store" } });
      }

      // ===== Googleから戻ってくる =====
      if (req.method === "GET" && url.pathname === "/auth/callback") {
        const state = url.searchParams.get("state") || "";
        const code = url.searchParams.get("code") || "";
        const stateOk = state && (await env.HITOKOTO.get("state:" + state));
        if (stateOk) await env.HITOKOTO.delete("state:" + state);
        if (!stateOk || !code) return redirectToAdmin("error=state");

        const r = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: url.origin + "/auth/callback", grant_type: "authorization_code",
          }),
        });
        const j = await r.json();
        if (!j.id_token) return redirectToAdmin("error=google");
        // Googleから直接（HTTPSで）受け取った id_token なので、内容を確認して使う
        const p = JSON.parse(new TextDecoder().decode(b64u.dec(j.id_token.split(".")[1])));
        const okIss = p.iss === "accounts.google.com" || p.iss === "https://accounts.google.com";
        const allowedEmails = String(env.ALLOWED_EMAIL || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
        const okEmail = typeof p.email === "string" && allowedEmails.includes(p.email.toLowerCase());
        if (p.aud !== env.GOOGLE_CLIENT_ID || !okIss || !(p.exp * 1000 > Date.now()) || p.email_verified !== true || !okEmail) {
          await addFail();
          return redirectToAdmin("error=denied");
        }
        const keys = await getPasskeys();
        if (!keys.length) return redirectToAdmin("s=" + (await newSession()));   // パスキー未登録 → そのまま入れる
        const pre = rand(32);
        await env.HITOKOTO.put("pre:" + pre, "1", { expirationTtl: PRE_TTL });
        return redirectToAdmin("p=" + pre);
      }

      if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (req.headers.get("Origin") !== allowed) return json({ error: "forbidden" }, 403);
      let body = {};
      try { body = await req.json(); } catch (e) { /* 空でもよい */ }

      // ===== bot認証（Cloudflare Turnstile）のサーバー確認 =====
      if (url.pathname === "/turnstile") {
        if (!env.TURNSTILE_SECRET) return json({ success: false, error: "not configured" }, 500);
        const token = typeof body.token === "string" ? body.token : "";
        if (!token) return json({ success: false }, 400);
        const f = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
        if (ip !== "unknown") f.set("remoteip", ip);
        const tr = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: f });
        const tj = await tr.json();
        let ok = !!tj.success;
        if (ok && tj.hostname && tj.hostname !== rpId) ok = false;   // 別のサイトで取られたトークンは無効
        return json({ success: ok });
      }

      // ===== パスキーで認証（Googleログイン後） =====
      if (url.pathname === "/auth/pk/auth-options") {
        if (await isBlocked()) return json({ error: "too many attempts" }, 429);
        if (!body.pre || !(await env.HITOKOTO.get("pre:" + body.pre))) return json({ error: "expired" }, 401);
        const keys = await getPasskeys();
        const challenge = rand(32);
        await env.HITOKOTO.put("chal:" + body.pre, challenge, { expirationTtl: PRE_TTL });
        return json({ challenge, rpId, allowCredentials: keys.map((k) => ({ type: "public-key", id: k.id })), userVerification: "required", timeout: 60000 });
      }

      if (url.pathname === "/auth/pk/auth-verify") {
        if (await isBlocked()) return json({ error: "too many attempts" }, 429);
        const pre = body.pre, c = body.credential || {};
        const challenge = pre && (await env.HITOKOTO.get("chal:" + pre));
        if (!challenge || !(await env.HITOKOTO.get("pre:" + pre))) return json({ error: "expired" }, 401);
        const keys = await getPasskeys();
        const cred = keys.find((k) => k.id === c.id);
        let ok = false;
        if (cred) {
          try {
            const ad = b64u.dec(c.authenticatorData), cdj = b64u.dec(c.clientDataJSON), sig = b64u.dec(c.signature);
            const pa = parseAuthData(ad);
            const hashOk = eqBytes(pa.rpIdHash, await sha256(new TextEncoder().encode(rpId)));
            const flagsOk = (pa.flags & 0x01) && (pa.flags & 0x04); // 本人操作 + 本人確認
            const cdOk = checkClientData(cdj, "webauthn.get", challenge, allowed);
            if (hashOk && flagsOk && cdOk) {
              const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: cred.x, y: cred.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
              const signed = new Uint8Array(ad.length + 32);
              signed.set(ad, 0); signed.set(await sha256(cdj), ad.length);
              ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(sig), signed);
            }
          } catch (e) { ok = false; }
        }
        if (!ok) { await addFail(); return json({ error: "passkey failed" }, 401); }
        await env.HITOKOTO.delete("pre:" + pre); await env.HITOKOTO.delete("chal:" + pre);
        return json({ token: await newSession() });
      }

      // ===== ここから先はログイン必須 =====
      if (!(await isLoggedIn())) return json({ error: "unauthorized" }, 401);

      if (url.pathname === "/auth/logout") {
        await env.HITOKOTO.delete("sess:" + bearer());
        return json({ ok: true });
      }

      // ===== パスキーの追加 =====
      if (url.pathname === "/auth/pk/reg-options") {
        const keys = await getPasskeys();
        const challenge = rand(32);
        await env.HITOKOTO.put("regchal:" + bearer(), challenge, { expirationTtl: PRE_TTL });
        return json({
          challenge, rp: { id: rpId, name: "天舞宙 管理" },
          user: { id: rand(16), name: "admin", displayName: "admin" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          excludeCredentials: keys.map((k) => ({ type: "public-key", id: k.id })),
          authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
          attestation: "none", timeout: 60000,
        });
      }

      if (url.pathname === "/auth/pk/reg-verify") {
        const c = body.credential || {};
        const challenge = await env.HITOKOTO.get("regchal:" + bearer());
        if (!challenge) return json({ error: "expired" }, 400);
        try {
          const cdj = b64u.dec(c.clientDataJSON);
          if (!checkClientData(cdj, "webauthn.create", challenge, allowed)) return json({ error: "bad client data" }, 400);
          const att = cborDecode(b64u.dec(c.attestationObject))[0];
          const ad = att.get("authData");
          const pa = parseAuthData(ad);
          if (!eqBytes(pa.rpIdHash, await sha256(new TextEncoder().encode(rpId)))) return json({ error: "bad rp" }, 400);
          if (!((pa.flags & 0x01) && (pa.flags & 0x04) && (pa.flags & 0x40))) return json({ error: "bad flags" }, 400);
          let o = 37 + 16;
          const idLen = (ad[o] << 8) | ad[o + 1]; o += 2;
          const credId = ad.slice(o, o + idLen); o += idLen;
          const cose = cborDecode(ad, o)[0];
          if (cose.get(3) !== -7 || cose.get(1) !== 2 || cose.get(-1) !== 1) return json({ error: "unsupported key" }, 400);
          const id = b64u.enc(credId);
          const keys = await getPasskeys();
          if (keys.some((k) => k.id === id)) return json({ error: "already registered" }, 400);
          keys.push({ id, x: b64u.enc(cose.get(-2)), y: b64u.enc(cose.get(-3)), created: new Date().toISOString() });
          await env.HITOKOTO.put("passkeys", JSON.stringify(keys.slice(-10)));
          await env.HITOKOTO.delete("regchal:" + bearer());
          return json({ ok: true });
        } catch (e) { return json({ error: "register failed" }, 400); }
      }

      if (url.pathname === "/auth/pk/list") {
        return json({ keys: (await getPasskeys()).map((k) => ({ id: k.id, created: k.created })) });
      }
      if (url.pathname === "/auth/pk/delete") {
        const keys = (await getPasskeys()).filter((k) => k.id !== body.id);
        await env.HITOKOTO.put("passkeys", JSON.stringify(keys));
        return json({ ok: true });
      }

      // ===== 一言の保存 =====
      if (url.pathname === "/") {
        const text = typeof body.text === "string" ? body.text.slice(0, 120) : "";
        const updatedAt = typeof body.updatedAt === "string" ? body.updatedAt.slice(0, 40) : null;
        const history = (Array.isArray(body.history) ? body.history : [])
          .filter((h) => h && typeof h.text === "string").slice(0, 10)
          .map((h) => ({ text: h.text.slice(0, 120), at: typeof h.at === "string" ? h.at.slice(0, 40) : null }));
        await env.HITOKOTO.put("data", JSON.stringify({ text, updatedAt, history }));
        return json({ ok: true });
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "server error" }, 500);
    }
  },
};
