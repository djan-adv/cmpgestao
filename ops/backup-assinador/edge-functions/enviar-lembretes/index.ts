import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(b, s) { return new Response(JSON.stringify(b), { status: s || 200, headers: { ...CORS, "Content-Type": "application/json" } }); }
function esc(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function emailValido(e) { return typeof e === "string" && /.+@.+\..+/.test(e.trim()); }

function estaNaHora(criado, lembretes, ultimo, agora) {
  const min = (agora.getTime() - new Date(criado).getTime()) / 60000;
  if (lembretes === 0) return min >= 30;
  if (lembretes === 1) return min >= 60;
  // diario apos 09:00 BRT (=12:00 UTC)
  if (agora.getUTCHours() < 12) return false;
  const hoje12 = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 12, 0, 0));
  return !ultimo || new Date(ultimo).getTime() < hoje12.getTime();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let client = null;
  try {
    const office = Deno.env.get("OFFICE_EMAIL") || "contato@cmpadvogados.com.br";
    const from = Deno.env.get("SMTP_USERNAME") || office;
    const admin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

    const q = await admin.from("signatarios")
      .select("id, email, nome, token, criado_em, lembretes, ultimo_lembrete, documento_id, documentos!inner(titulo, tipo, status)")
      .neq("status", "assinado").not("email", "is", null);
    if (q.error) return json({ ok: false, erro: q.error.message }, 500);
    const linhas = (q.data || []).filter((r) => emailValido(r.email) && r.documentos && r.documentos.status !== "assinado" && r.documentos.status !== "cancelado");

    const agora = new Date();
    const pendentes = linhas.filter((r) => estaNaHora(r.criado_em, r.lembretes || 0, r.ultimo_lembrete, agora));
    if (!pendentes.length) return json({ ok: true, enviados: 0 });

    client = new SMTPClient({
      connection: { hostname: Deno.env.get("SMTP_HOSTNAME") || "smtp.hostinger.com", port: Number(Deno.env.get("SMTP_PORT") || "465"), tls: true, auth: { username: from, password: Deno.env.get("CMP_EMAIL_PASS") } },
    });
    const logo = "https://djan.app.br/link/cmp-logo.png";
    let enviados = 0;
    for (const r of pendentes) {
      try {
        const base = r.documentos.tipo === "procuracao" ? "assinar.html" : "assinar-doc.html";
        const link = "https://djan.app.br/link/" + base + "?d=" + r.documento_id + "&s=" + r.token;
        const doc = esc(r.documentos.titulo || "documento");
        const saud = r.nome ? ", <strong>" + esc(r.nome) + "</strong>" : "";
        const html = [
          '<!doctype html><html><body style="margin:0;background:#eef1f5;padding:24px 0;font-family:Arial,Helvetica,sans-serif">',
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">',
          '<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">',
          '<tr><td style="background:#1f3a5f;border-radius:10px 10px 0 0;padding:18px 24px" align="left">',
          '<img src="' + logo + '" alt="CMP Advogados" height="40" style="height:40px;background:#ffffff;padding:5px 9px;border-radius:6px;display:inline-block"></td></tr>',
          '<tr><td style="background:#ffffff;border:1px solid #d9dde3;border-top:none;border-radius:0 0 10px 10px;padding:28px 26px;color:#1c2733;font-size:15px;line-height:1.6">',
          '<p style="margin:0 0 14px">Ola' + saud + ',</p>',
          '<p style="margin:0 0 8px">Este e um lembrete: o documento abaixo ainda aguarda a sua assinatura.</p>',
          '<p style="margin:0 0 22px;font-size:16px"><strong>' + doc + '</strong></p>',
          '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 22px"><tr><td align="center" bgcolor="#1f3a5f" style="border-radius:8px">',
          '<a href="' + link + '" target="_blank" style="display:inline-block;padding:14px 34px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:8px">Assinar agora</a>',
          '</td></tr></table>',
          '<p style="margin:0 0 18px;font-size:13px;color:#5b6673">Se ja assinou, pode ignorar este e-mail.</p>',
          '<hr style="border:none;border-top:1px solid #eef0f3;margin:20px 0">',
          '<p style="margin:0;font-size:12px;color:#5b6673"><strong>Crispim, Mendonca e Pinheiro Advogados</strong><br>0800 591 7259 | ' + esc(office) + '</p>',
          '</td></tr></table></td></tr></table></body></html>',
        ].join("");
        await client.send({ from: "CMP Advogados <" + from + ">", to: r.email, subject: "Lembrete de assinatura - " + (r.documentos.titulo || "documento"), html });
        await admin.from("signatarios").update({ lembretes: (r.lembretes || 0) + 1, ultimo_lembrete: agora.toISOString() }).eq("id", r.id);
        enviados++;
      } catch (_e) { /* segue */ }
    }
    try { if (client) await client.close(); } catch (_e) { /* ignora */ }
    return json({ ok: true, enviados });
  } catch (e) {
    try { if (client) await client.close(); } catch (_e2) { /* ignora */ }
    return json({ ok: false, erro: String((e && e.message) || e) }, 500);
  }
});
