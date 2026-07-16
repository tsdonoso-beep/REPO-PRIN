// viatico-guardar · sube la boleta a Storage, la lee con Gemini (pool de keys) e inserta el gasto.
// Degradación elegante: sin GEMINI_KEYS, el gasto se crea igual para llenado manual.
// Secretos: GEMINI_KEYS (una key o varias separadas por comas), GEMINI_MODEL (opcional).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const CATS = ['combustible', 'alimentacion', 'hospedaje', 'movilidad', 'peajes', 'materiales', 'otros'];
const TIPOS = ['boleta', 'factura', 'proforma', 'ticket', 'transferencia', 'otro'];
const norm = (s: unknown) => (s == null ? '' : String(s).trim().toLowerCase());
async function bestEffort(p: any) { try { await p; } catch (_) { /* telemetría no crítica */ } }

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function extFromMime(m: string): string {
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('pdf')) return 'pdf';
  return 'jpg';
}
function normDate(s: unknown): string | null {
  if (!s) return null;
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    tipo_comprobante: { type: 'STRING', enum: TIPOS },
    proveedor: { type: 'STRING' },
    ruc: { type: 'STRING' },
    serie_numero: { type: 'STRING' },
    entidad_pago: { type: 'STRING' },
    nro_operacion: { type: 'STRING' },
    placa: { type: 'STRING' },
    moneda: { type: 'STRING', enum: ['PEN', 'USD'] },
    total: { type: 'NUMBER' },
    fecha_emision: { type: 'STRING' },
    categoria: { type: 'STRING', enum: CATS },
    concepto: { type: 'STRING' },
    confianza: { type: 'NUMBER' },
  },
};
const PROMPT = `Eres un asistente que extrae datos de comprobantes de gasto peruanos (boletas, facturas, proformas, tickets y comprobantes de transferencia Yape/Plin).
Devuelve SOLO el JSON del esquema. Reglas:
- Si un campo no aparece, omítelo. NO inventes datos. Prefiere no poner un monto o RUC antes que adivinarlo.
- Moneda por símbolo: "S/" = PEN, "$" = USD. Usa la del total.
- total: usa el impreso. Si está en blanco, no lo pongas.
- fecha_emision en formato AAAA-MM-DD.
- Yape/Plin: tipo_comprobante=transferencia; entidad_pago=Yape o Plin; proveedor=nombre del destinatario; nro_operacion=número de operación. NO infieras la categoría de una transferencia.
- Boletas/facturas: categoriza por naturaleza (grifo=combustible, restaurante=alimentacion, hotel=hospedaje, taxi/pasaje=movilidad, peaje=peajes, insumos=materiales, resto=otros).
- confianza: 0 a 1 sobre la lectura global.`;

async function geminiExtract(imageB64: string, mime: string, supa: any): Promise<any | null> {
  const raw = Deno.env.get('GEMINI_KEYS');
  if (!raw) { console.error('OCR: falta GEMINI_KEYS'); return null; }
  let keys: string[] = [];
  try { const p = JSON.parse(raw); keys = Array.isArray(p) ? p : [String(p)]; } catch { keys = raw.split(',').map((s) => s.trim()).filter(Boolean); }
  keys = keys.map((k) => String(k).trim()).filter(Boolean);
  if (!keys.length) { console.error('OCR: pool vacío'); return null; }
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.1-flash-lite-preview';
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: mime, data: imageB64 } }, { text: PROMPT }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
  };
  for (let i = 0; i < keys.length; i++) {
    const alias = 'key' + (i + 1);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${keys[i]}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status === 429 || res.status === 403) {
        console.error('OCR:', alias, 'cuota', res.status);
        await bestEffort(supa.from('gemini_keys').upsert({ alias, agotada_hasta: new Date(Date.now() + 6 * 3600e3).toISOString() }, { onConflict: 'alias' }));
        continue;
      }
      if (!res.ok) { const t = await res.text(); console.error('OCR: HTTP', res.status, t.slice(0, 300)); continue; }
      const j = await res.json();
      const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!txt) { console.error('OCR: respuesta sin texto'); continue; }
      await bestEffort(supa.from('gemini_keys').upsert({ alias, ultimo_uso: new Date().toISOString() }, { onConflict: 'alias' }));
      return JSON.parse(txt);
    } catch (e) { console.error('OCR: excepción', String((e as any)?.message || e)); continue; }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const b = await req.json();
    const { tecnico_id, rendicion_id, image_base64, mime, thumb } = b;
    if (!tecnico_id || !image_base64) return json({ error: 'Faltan datos (tecnico_id, image_base64).' }, 400);

    const { data: tec } = await supa.from('tecnicos').select('id,estado').eq('id', tecnico_id).single();
    if (!tec || tec.estado !== 'activo') return json({ error: 'Técnico no válido.' }, 403);
    if (rendicion_id) {
      const { data: ren } = await supa.from('rendiciones').select('id,tecnico_id').eq('id', rendicion_id).single();
      if (!ren || ren.tecnico_id !== tecnico_id) return json({ error: 'Rendición no válida.' }, 403);
    }

    const m = mime || 'image/jpeg';
    const bytes = b64ToBytes(image_base64);
    const path = `${tecnico_id}/${crypto.randomUUID()}.${extFromMime(m)}`;
    const up = await supa.storage.from('viaticos').upload(path, bytes, { contentType: m, upsert: false });
    if (up.error) return json({ error: 'No se pudo guardar la imagen: ' + up.error.message }, 500);
    const signed = await supa.storage.from('viaticos').createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
    const imagen_url = signed.data?.signedUrl || null;

    let ocr: any = null;
    try { ocr = await geminiExtract(image_base64, m, supa); } catch (e) { console.error('OCR wrap', String(e)); ocr = null; }

    const row: any = {
      rendicion_id: rendicion_id || null, tecnico_id,
      imagen_path: path, imagen_url, thumb: thumb || null, mime: m,
      estado: 'por_revisar', moneda: 'PEN',
    };
    if (ocr) {
      row.tipo_comprobante = TIPOS.includes(norm(ocr.tipo_comprobante)) ? norm(ocr.tipo_comprobante) : null;
      row.categoria = CATS.includes(norm(ocr.categoria)) ? norm(ocr.categoria) : null;
      row.moneda = norm(ocr.moneda) === 'usd' ? 'USD' : 'PEN';
      row.proveedor = ocr.proveedor ?? null;
      row.ruc = ocr.ruc ?? null;
      row.serie_numero = ocr.serie_numero ?? null;
      row.entidad_pago = ocr.entidad_pago ?? null;
      row.nro_operacion = ocr.nro_operacion ?? null;
      row.placa = ocr.placa ?? null;
      row.concepto = ocr.concepto ?? null;
      const tot = typeof ocr.total === 'number' ? ocr.total : parseFloat(ocr.total);
      row.total = isFinite(tot) ? tot : null;
      row.fecha_emision = normDate(ocr.fecha_emision);
      row.confianza_ocr = typeof ocr.confianza === 'number' ? ocr.confianza : null;
      row.ocr_json = ocr;
    }

    const { data: gasto, error: gErr } = await supa.from('gastos').insert(row).select().single();
    if (gErr) return json({ error: 'Imagen guardada pero falló el registro: ' + gErr.message }, 500);
    return json({ ok: true, gasto, ocr_aplicado: !!ocr });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
