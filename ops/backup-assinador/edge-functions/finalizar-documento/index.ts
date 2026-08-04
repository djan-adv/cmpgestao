import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { getDocumentProxy } from "https://esm.sh/unpdf@0.11.0";

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
  let bin = ""; const c = 0x8000;
  for (let i = 0; i < bytes.length; i += c) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + c));
  return btoa(bin);
}
function norm(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// Extrai, da ULTIMA pagina, as "linhas" de texto com posicao (x,y em unidades PDF, origem inferior-esquerda).
async function linhasUltimaPagina(bytes) {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const page = await pdf.getPage(pdf.numPages);
    const tc = await page.getTextContent();
    const items = (tc.items || []).filter((it) => it.str && it.str.trim());
    const linhas = [];
    for (const it of items) {
      const x = it.transform[4], y = it.transform[5];
      let alvo = linhas.find((l) => Math.abs(l.y - y) < 4);
      if (!alvo) { alvo = { y, minx: x, itens: [] }; linhas.push(alvo); }
      alvo.itens.push({ x, str: it.str });
      if (x < alvo.minx) alvo.minx = x;
    }
    for (const l of linhas) {
      l.itens.sort((a, b) => a.x - b.x);
      l.texto = l.itens.map((i) => i.str).join(" ");
      l.normal = norm(l.texto);
    }
    return linhas;
  } catch (_e) { return []; }
}

function acharNome(linhas, nome) {
  const n = norm(nome);
  if (!n) return null;
  const partes = n.split(" ").filter((p) => p.length > 2);
  for (const l of linhas) {
    if (l.normal.includes(n)) return l;
  }
  // fallback: linha que contenha ao menos 2 partes do nome (ex.: primeiro + ultimo)
  let melhor = null, melhorScore = 0;
  for (const l of linhas) {
    let s = 0; for (const p of partes) if (l.normal.includes(p)) s++;
    if (s >= 2 && s > melhorScore) { melhor = l; melhorScore = s; }
  }
  return melhor;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const doc_id = body.doc_id;
    if (!doc_id) return json({ ok: false, erro: "doc_id obrigatorio" }, 400);

    const office = Deno.env.get("OFFICE_EMAIL") || "contato@cmpadvogados.com.br";
    const from = Deno.env.get("SMTP_USERNAME") || office;
    const admin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

    const docQ = await admin.from("documentos").select("*").eq("id", doc_id).single();
    if (docQ.error || !docQ.data) return json({ ok: false, erro: "documento nao encontrado" }, 404);
    const doc = docQ.data;
    const sigQ = await admin.from("signatarios").select("*").eq("documento_id", doc_id).order("ordem", { ascending: true });
    const sigs = sigQ.data || [];
    if (sigs.filter((s) => s.status !== "assinado").length > 0) return json({ ok: true, pendente: true });

    const evQ = await admin.from("eventos_auditoria").select("id").eq("documento_id", doc_id).eq("tipo", "documento_finalizado").limit(1);
    if (evQ.data && evQ.data.length > 0) return json({ ok: true, jafinalizado: true });

    const dl = await admin.storage.from("documentos").download(doc.arquivo_path);
    if (dl.error || !dl.data) return json({ ok: false, erro: "PDF original nao encontrado" }, 404);
    const origBytes = new Uint8Array(await dl.data.arrayBuffer());

    const pdf = await PDFDocument.load(origBytes);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const pages = pdf.getPages();
    const last = pages[pages.length - 1];
    const { width: LW, height: LH } = last.getSize();

    const linhas = await linhasUltimaPagina(origBytes);

    // carrega as imagens das assinaturas
    const imgs = {};
    for (const s of sigs) {
      if (!s.assinatura_path) continue;
      try {
        const su = await admin.storage.from("assinaturas").download(s.assinatura_path);
        if (!su.error && su.data) imgs[s.id] = await pdf.embedPng(new Uint8Array(await su.data.arrayBuffer()));
      } catch (_e) { /* ignora */ }
    }

    // 1) tenta sobrepor a assinatura acima do nome; 2) senao, rodape
    let footerY = 130;
    for (const s of sigs) {
      const png = imgs[s.id];
      if (!png) continue;
      const linha = acharNome(linhas, s.nome || "");
      const maxW = 150;
      let w = maxW, h = png.height * w / png.width;
      if (h > 34) { h = 34; w = png.width * h / png.height; if (w > maxW) { w = maxW; h = png.height * w / png.width; } }
      if (linha && linha.y > 40 && linha.y < LH - 20) {
        const x = Math.max(40, Math.min(linha.minx, LW - w - 20));
        last.drawImage(png, { x, y: linha.y + 4, width: w, height: h });
      } else {
        if (footerY < 40) { last.drawImage(png, { x: 40, y: 40, width: w, height: h }); }
        else {
          last.drawImage(png, { x: 56, y: footerY, width: w, height: h });
          last.drawLine({ start: { x: 56, y: footerY - 4 }, end: { x: 56 + 200, y: footerY - 4 }, thickness: 0.6, color: rgb(0.35, 0.35, 0.35) });
          last.drawText((s.nome || s.email || "").slice(0, 60), { x: 56, y: footerY - 16, size: 9, font, color: rgb(0.15, 0.15, 0.15) });
          footerY -= 58;
        }
      }
    }

    // trilha de auditoria em pagina anexada
    let page = pdf.addPage([595.28, 841.89]);
    const navy = rgb(0.12, 0.20, 0.31);
    const M = 56; let y = 785;
    page.drawText("TRILHA DE AUDITORIA", { x: M, y, size: 14, font: bold, color: navy }); y -= 10;
    page.drawLine({ start: { x: M, y }, end: { x: 539, y }, thickness: 1.2, color: navy }); y -= 24;
    page.drawText("Documento: " + (doc.titulo || ""), { x: M, y, size: 11, font }); y -= 24;
    for (const s of sigs) {
      if (y < 90) { page = pdf.addPage([595.28, 841.89]); y = 785; }
      const linha = (t, b) => { page.drawText(t, { x: M, y, size: 10, font: b ? bold : font, color: rgb(0.1, 0.1, 0.1) }); y -= 14; };
      linha(s.nome || s.email || "", true);
      if (s.cpf) linha("CPF: " + s.cpf);
      linha("E-mail: " + (s.email || ""));
      linha("Assinado em: " + (s.assinado_em ? new Date(s.assinado_em).toLocaleString("pt-BR") : ""));
      if (s.ip) linha("IP: " + s.ip);
      linha("Identificador: " + s.id);
      y -= 10;
    }
    if (y < 70) { page = pdf.addPage([595.28, 841.89]); y = 785; }
    page.drawText("Assinado eletronicamente nos termos da Lei 14.063/2020 e da MP 2.200-2/2001.", { x: M, y: 60, size: 8, font, color: rgb(0.35, 0.35, 0.35) });
    page.drawText("CMP Advogados - 0800 591 7259 - " + office, { x: M, y: 48, size: 8, font, color: rgb(0.35, 0.35, 0.35) });

    const finalBytes = await pdf.save();
    await admin.storage.from("documentos").upload(doc_id + "/assinado.pdf", new Blob([finalBytes], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });

    const doct = esc(doc.titulo || "documento");
    const nomeArq = (doc.titulo || "documento").replace(/[^\w\-]+/g, "_") + "_assinado.pdf";
    const logo = "https://djan.app.br/link/cmp-logo.png";
    const html = [
      '<!doctype html><html><body style="margin:0;background:#eef1f5;padding:24px 0;font-family:Arial,Helvetica,sans-serif">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">',
      '<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">',
      '<tr><td style="background:#1f3a5f;border-radius:10px 10px 0 0;padding:18px 24px" align="left">',
      '<img src="' + logo + '" alt="CMP Advogados" height="40" style="height:40px;background:#ffffff;padding:5px 9px;border-radius:6px;display:inline-block"></td></tr>',
      '<tr><td style="background:#ffffff;border:1px solid #d9dde3;border-top:none;border-radius:0 0 10px 10px;padding:28px 26px;color:#1c2733;font-size:15px;line-height:1.6">',
      '<p style="margin:0 0 8px">O documento abaixo foi assinado por todos os signatarios. Segue em anexo a versao final assinada, com a trilha de auditoria.</p>',
      '<p style="margin:0 0 22px;font-size:16px"><strong>' + doct + '</strong></p>',
      '<p style="margin:0 0 18px;font-size:14px;color:#5b6673">Guarde este arquivo. Em caso de duvida, basta responder a este e-mail.</p>',
      '<hr style="border:none;border-top:1px solid #eef0f3;margin:20px 0">',
      '<p style="margin:0;font-size:12px;color:#5b6673">Assinatura com validade juridica (Lei 14.063/2020 e MP 2.200-2/2001).<br><strong>Crispim, Mendonca e Pinheiro Advogados</strong><br>0800 591 7259 | ' + esc(office) + '</p>',
      '</td></tr></table></td></tr></table></body></html>',
    ].join("");

    const client = new SMTPClient({
      connection: { hostname: Deno.env.get("SMTP_HOSTNAME") || "smtp.hostinger.com", port: Number(Deno.env.get("SMTP_PORT") || "465"), tls: true, auth: { username: from, password: Deno.env.get("CMP_EMAIL_PASS") } },
    });
    const anexo = { filename: nomeArq, content: toB64(new Uint8Array(finalBytes)), encoding: "base64", contentType: "application/pdf" };
    const emails = {};
    for (const s of sigs) if (s.email) emails[s.email.toLowerCase()] = s.email;
    emails[office.toLowerCase()] = office;
    for (const to of Object.values(emails)) {
      try { await client.send({ from: "CMP Advogados <" + from + ">", to, subject: "Documento assinado - " + (doc.titulo || "documento"), html, attachments: [anexo] }); } catch (_e) { /* segue */ }
    }
    await client.close();

    await admin.from("documentos").update({ status: "assinado" }).eq("id", doc_id);
    await admin.from("eventos_auditoria").insert({ documento_id: doc_id, tipo: "documento_finalizado", detalhe: "Documento final assinado e enviado a " + Object.keys(emails).length + " destinatario(s)" });
    return json({ ok: true, finalizado: true });
  } catch (e) {
    return json({ ok: false, erro: String((e && e.message) || e) }, 500);
  }
});
