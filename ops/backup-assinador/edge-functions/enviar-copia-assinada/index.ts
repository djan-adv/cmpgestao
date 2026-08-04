import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
function toB64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const doc_id = body.doc_id, cliente_email = body.cliente_email, cliente_nome = body.cliente_nome, titulo = body.titulo, pdf_path = body.pdf_path;
    if (!doc_id || !cliente_email) return json({ ok: false, erro: "doc_id e cliente_email obrigatorios" }, 400);

    const office = Deno.env.get("OFFICE_EMAIL") || "contato@cmpadvogados.com.br";
    const from = Deno.env.get("SMTP_USERNAME") || office;
    const remetente = "CMP Advogados <" + from + ">";
    const path = pdf_path || (doc_id + ".pdf");

    const admin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const dl = await admin.storage.from("documentos").download(path);
    if (dl.error || !dl.data) return json({ ok: false, erro: "PDF nao encontrado: " + ((dl.error && dl.error.message) || path) }, 404);
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const b64pdf = toB64(bytes);

    const doc = esc(titulo || "documento");
    const nomeArq = (titulo || "documento").replace(/[^\w\-]+/g, "_") + "_assinado.pdf";
    const saud = cliente_nome ? ", <strong>" + esc(cliente_nome) + "</strong>" : "";
    const logo = "https://djan.app.br/link/cmp-logo.png";

    const html = [
      '<!doctype html><html><body style="margin:0;background:#eef1f5;padding:24px 0;font-family:Arial,Helvetica,sans-serif">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">',
      '<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">',
      '<tr><td style="background:#1f3a5f;border-radius:10px 10px 0 0;padding:18px 24px" align="left">',
      '<img src="' + logo + '" alt="CMP Advogados" height="40" style="height:40px;background:#ffffff;padding:5px 9px;border-radius:6px;display:inline-block"></td></tr>',
      '<tr><td style="background:#ffffff;border:1px solid #d9dde3;border-top:none;border-radius:0 0 10px 10px;padding:28px 26px;color:#1c2733;font-size:15px;line-height:1.6">',
      '<p style="margin:0 0 14px">Ola' + saud + ',</p>',
      '<p style="margin:0 0 8px">Segue em anexo a copia do documento abaixo, assinado eletronicamente, com a trilha de auditoria.</p>',
      '<p style="margin:0 0 22px;font-size:16px"><strong>' + doc + '</strong></p>',
      '<p style="margin:0 0 18px;font-size:14px;color:#5b6673">Guarde este arquivo. Em caso de duvida, basta responder a este e-mail.</p>',
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
    const anexo = { filename: nomeArq, content: b64pdf, encoding: "base64", contentType: "application/pdf" };

    const dests = (cliente_email.toLowerCase() === office.toLowerCase()) ? [office] : [cliente_email, office];
    const resultados = {};
    for (let i = 0; i < dests.length; i++) {
      try {
        await client.send({
          from: remetente,
          to: dests[i],
          subject: "Copia assinada - " + (titulo || "documento"),
          html,
          attachments: [anexo],
        });
        resultados[dests[i]] = "ok";
      } catch (err) {
        resultados[dests[i]] = "erro: " + String((err && err.message) || err);
      }
    }
    await client.close();

    await admin.from("eventos_auditoria").insert({
      documento_id: doc_id,
      tipo: "copia_enviada",
      detalhe: "Copia assinada enviada: " + JSON.stringify(resultados),
    });
    const algumOk = Object.values(resultados).some((v) => v === "ok");
    return json({ ok: algumOk, resultados }, algumOk ? 200 : 500);
  } catch (e) {
    return json({ ok: false, erro: String((e && e.message) || e) }, 500);
  }
});
