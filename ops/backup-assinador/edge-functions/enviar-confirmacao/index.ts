import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b, s) => new Response(JSON.stringify(b), { status: s || 200, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wrap(inner) {
  const logo = "https://djan.app.br/link/cmp-logo.png";
  return '<!doctype html><html><body style="margin:0;background:#eef1f5;padding:24px 0;font-family:Arial,Helvetica,sans-serif">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
    '<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">' +
    '<tr><td style="background:#1f3a5f;border-radius:10px 10px 0 0;padding:18px 24px" align="left">' +
    '<img src="' + logo + '" alt="CMP Advogados" height="40" style="height:40px;background:#ffffff;padding:5px 9px;border-radius:6px;display:inline-block"></td></tr>' +
    '<tr><td style="background:#ffffff;border:1px solid #d9dde3;border-top:none;border-radius:0 0 10px 10px;padding:28px 26px;color:#1c2733;font-size:15px;line-height:1.6">' +
    inner +
    '<hr style="border:none;border-top:1px solid #eef0f3;margin:20px 0"><p style="margin:0;font-size:12px;color:#5b6673"><strong>Crispim, Mendonca e Pinheiro Advogados</strong><br>0800 591 7259</p>' +
    '</td></tr></table></td></tr></table></body></html>';
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const b = await req.json();
    const office = Deno.env.get("OFFICE_EMAIL") || "contato@cmpadvogados.com.br";
    const from = Deno.env.get("SMTP_USERNAME") || office;
    const client = new SMTPClient({ connection: { hostname: Deno.env.get("SMTP_HOSTNAME") || "smtp.hostinger.com", port: Number(Deno.env.get("SMTP_PORT") || "465"), tls: true, auth: { username: from, password: Deno.env.get("CMP_EMAIL_PASS") } } });
    const doc = esc(b.titulo || "documento");

    if (b.modo === "pedir") {
      if (!b.email || !b.link) return json({ ok: false, erro: "email e link obrigatorios" }, 400);
      const saud = b.nome ? ", <strong>" + esc(b.nome) + "</strong>" : "";
      const inner = '<p style="margin:0 0 14px">Ola' + saud + ',</p>' +
        '<p style="margin:0 0 8px">Recebemos a sua assinatura no documento <strong>' + doc + '</strong>. Para reforcar a seguranca, confirme abaixo que foi voce quem assinou.</p>' +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto"><tr><td align="center" bgcolor="#1f7a44" style="border-radius:8px">' +
        '<a href="' + esc(b.link) + '" target="_blank" style="display:inline-block;padding:14px 34px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:8px">Confirmar minha assinatura</a></td></tr></table>' +
        '<p style="margin:0;font-size:13px;color:#5b6673">Se voce nao assinou este documento, responda a este e-mail imediatamente.</p>';
      await client.send({ from: "CMP Advogados <" + from + ">", to: b.email, subject: "Confirme sua assinatura - " + (b.titulo || "documento"), html: wrap(inner) });
      await client.close();
      return json({ ok: true });
    }

    if (b.modo === "avisar") {
      const inner = '<p style="margin:0 0 8px"><strong>Dupla verificacao concluida.</strong></p>' +
        '<p style="margin:0 0 8px">O signatario <strong>' + esc(b.nome || b.email || "") + '</strong> confirmou por e-mail a assinatura do documento <strong>' + doc + '</strong>.</p>' +
        '<p style="margin:0;font-size:13px;color:#5b6673">Confirmado em: ' + esc(b.quando || "") + (b.ip ? ' &middot; IP ' + esc(b.ip) : "") + '</p>';
      await client.send({ from: "CMP Advogados <" + from + ">", to: office, subject: "Assinatura confirmada (dupla verificacao) - " + (b.titulo || "documento"), html: wrap(inner) });
      await client.close();
      return json({ ok: true });
    }

    await client.close();
    return json({ ok: false, erro: "modo invalido" }, 400);
  } catch (e) {
    return json({ ok: false, erro: String((e && e.message) || e) }, 500);
  }
});
