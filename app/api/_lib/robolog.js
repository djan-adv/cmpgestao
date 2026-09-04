// O que cada robô fez, POR ESCRITÓRIO.
//
// cron_exec guarda a rodada inteira — é a visão de quem opera o sistema, e
// mistura todos os escritórios numa linha só. O escritório cliente precisa da
// linha dele: quando o robô dele rodou, se deu certo e o que trouxe. Sem isso o
// painel de robôs ou fica escondido dele (foi o que aconteceu) ou mostra o
// resultado do fornecedor como se fosse dele — as duas saídas ruins.
import { createClient } from '@supabase/supabase-js'

export async function anotarRobo(esc, nome, ok, resultado) {
  if (!esc || !nome) return
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
    await sb.from('robo_exec_esc').upsert({
      escritorio_id: esc, nome,
      ultima_exec: new Date().toISOString(),
      ultimo_ok: ok === null || ok === undefined ? null : !!ok,
      ultimo_resultado: String(resultado == null ? '' : resultado).slice(0, 400),
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'escritorio_id,nome' })
  } catch (e) { /* registrar o robô nunca pode derrubar o robô */ }
}
