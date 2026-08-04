import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(b, s) {
  return new Response(JSON.stringify(b), { status: s || 200, headers: { ...CORS, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const token = body.token;
    if (!token) return json({ ok: false, erro: "token obrigatorio" }, 400);
    const admin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const sq = await admin.from("signatarios").select("documento_id").eq("token", token).maybeSingle();
    if (sq.error || !sq.data) return json({ ok: false, erro: "link invalido" }, 404);
    const dq = await admin.from("documentos").select("arquivo_path").eq("id", sq.data.documento_id).maybeSingle();
    if (dq.error || !dq.data || !dq.data.arquivo_path) return json({ ok: false, erro: "arquivo nao encontrado" }, 404);
    const su = await admin.storage.from("documentos").createSignedUrl(dq.data.arquivo_path, 3600);
    if (su.error) return json({ ok: false, erro: su.error.message }, 500);
    return json({ ok: true, url: su.data.signedUrl });
  } catch (e) {
    return json({ ok: false, erro: String((e && e.message) || e) }, 500);
  }
});
