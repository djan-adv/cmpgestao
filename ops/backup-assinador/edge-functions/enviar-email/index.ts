import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(b, s) {
  return new Response(JSON.stringify(b), { status: s || 200, headers: { ...CORS, "Content-Type": "application/json" } });
}
function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const to = body.to, nome = body.nome, titulo = body.titulo, link = body.link;
    if (!to || !link) return json({ ok: false, erro: "to e link obrigatorios" }, 400);

    const office = Deno.env.get("OFFICE_EMAIL") || "contato@cmpadvogados.com.br";
    const from = Deno.env.get("SMTP_USERNAME") || office;
    const doc = esc(titulo || "documento");
    const saud = nome ? ", <strong>" + esc(nome) + "</strong>" : "";
    const logo = "https://djan.app.br/link/cmp-logo.png";
    const lk = esc(link);

    const html = [
      '<!doctype html><html><body style="margin:0;background:#eef1f5;padding:24px 0;font-family:Arial,Helvetica,sans-serif">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">',
      '<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">',
      '<tr><td style="background:#1f3a5f;border-radius:10px 10px 0 0;padding:18px 24px" align="left">',
      '<img src="' + logo + '" alt="CMP Advogados" height="40" style="height:40px;background:#ffffff;padding:5px 9px;border-radius:6px;display:inline-block"></td></tr>',
      '<tr><td style="background:#ffffff;border:1px solid #d9dde3;border-top:none;border-radius:0 0 10px 10px;padding:28px 26px;color:#1c2733;font-size:15px;line-height:1.6">',
      '<p style="margin:0 0 14px">Ola' + saud + ',</p>',
      '<p style="margin:0 0 8px">Voce recebeu um documento para assinar eletronicamente:</p>',
      '<p style="margin:0 0 22px;font-size:16px"><strong>' + doc + '</strong></p>',
      '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 22px"><tr><td align="center" bgcolor="#1f3a5f" style="border-radius:8px">',
      '<a href="' + lk + '" target="_blank" style="display:inline-block;padding:14px 34px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:8px">Assinar documento</a>',
      '</td></tr></table>',
      '<p style="margin:0 0 18px;font-size:13px;color:#5b6673">Se o botao nao abrir, copie e cole este endereco no navegador:<br><a href="' + lk + '" style="color:#274b7d;word-break:break-all">' + lk + '</a></p>',
      '<hr style="border:none;border-top:1px solid #eef0f3;margin:20px 0">',
      '<p style="margin:0;font-size:12px;color:#5b6673">Assinatura com validade juridica (Lei 14.063/2020 e MP 2.200-2/2001).<br><strong>Crispim, Mendonca e Pinheiro Advogados</strong><br>0800 591 7259 | ' + esc(office) + '</p>',
      '</td></tr></table></td></tr></table></body></html>',
    ].join("");

    const client = new SMTPClient({
      connection: {
        hostname: Deno.env.get("SMTP_HOSTNAME") || "smtp.hostinger.com",
        port: Number(Deno.env.get("SMTP_PORT") || "465"),
        tls: true,
        auth: { username: from, password: Deno.env.get("CMP_EMAIL_PASS") },
      },
    });
    await client.send({
      from: "CMP Advogados <" + from + ">",
      to,
      subject: "Assinatura eletronica - " + (titulo || "documento"),
      html,
    });
    await client.close();
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ ok: false, erro: String((e && e.message) || e) }, 500);
  }
});
