// viatico-a-drive · al confirmar un gasto, sube su boleta al Drive de administración
// en la estructura: Viáticos / <Técnico> / <Rendición> / <archivo con nombre limpio>.
// Usa el service account (GOOGLE_SA_KEY) con supportsAllDrives, como el resto del sistema.
// La carpeta padre y el cache de subcarpetas se guardan en configuracion / rendiciones.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

function pemToBuf(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
  const bin = atob(b64); const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function b64url(data: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof data === 'string') bytes = new TextEncoder().encode(data);
  else bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function getAccessToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/drive', aud, exp: now + 3600, iat: now };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToBuf(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch(aud, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }) });
  const j = await res.json(); if (!j.access_token) throw new Error('Auth Google falló: ' + JSON.stringify(j));
  return j.access_token as string;
}
const H = (token: string) => ({ Authorization: `Bearer ${token}` });
async function findFolder(token: string, name: string, parent: string): Promise<string | null> {
  const q = `'${parent}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`, { headers: H(token) });
  const j = await res.json(); return j.files && j.files[0] ? j.files[0].id : null;
}
async function createFolder(token: string, name: string, parent: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id', { method: 'POST', headers: { ...H(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parents: [parent], mimeType: 'application/vnd.google-apps.folder' }) });
  const j = await res.json(); if (!j.id) throw new Error('No se pudo crear carpeta ' + name + ': ' + JSON.stringify(j)); return j.id;
}
async function ensureFolder(token: string, name: string, parent: string): Promise<string> { return (await findFolder(token, name, parent)) || (await createFolder(token, name, parent)); }
async function uploadFile(token: string, name: string, mime: string, bytes: Uint8Array, parent: string) {
  const boundary = 'rp' + crypto.randomUUID(); const enc = new TextEncoder();
  const meta = JSON.stringify({ name, parents: [parent] });
  const pre = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const post = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(pre.length + bytes.length + post.length);
  body.set(pre, 0); body.set(bytes, pre.length); body.set(post, pre.length + bytes.length);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink', { method: 'POST', headers: { ...H(token), 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  const j = await res.json(); if (!j.id) throw new Error('Error subiendo a Drive: ' + JSON.stringify(j));
  return { id: j.id as string, url: (j.webViewLink as string) || `https://drive.google.com/file/d/${j.id}/view` };
}
async function renameFile(token: string, id: string, name: string) {
  await fetch(`https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`, { method: 'PATCH', headers: { ...H(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}
const sani = (s: unknown, max = 40) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s.-]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) || 'sin-dato';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { tecnico_id, gasto_id } = await req.json();
    if (!tecnico_id || !gasto_id) return json({ error: 'Faltan datos.' }, 400);
    const { data: g } = await supa.from('gastos').select('*').eq('id', gasto_id).single();
    if (!g || g.tecnico_id !== tecnico_id) return json({ error: 'Gasto no válido.' }, 403);
    if (!g.imagen_path) return json({ error: 'El gasto no tiene imagen.' }, 400);

    const saRaw = Deno.env.get('GOOGLE_SA_KEY'); if (!saRaw) return json({ error: 'Falta GOOGLE_SA_KEY.' }, 400);
    const { data: cfg } = await supa.from('configuracion').select('viaticos_drive_parent_id,viaticos_drive_folder_id').eq('id', 1).single();
    const parent = cfg?.viaticos_drive_parent_id; if (!parent) return json({ error: 'Falta configurar la carpeta de Viáticos.' }, 400);
    const { data: tec } = await supa.from('tecnicos').select('nombre').eq('id', tecnico_id).single();

    const token = await getAccessToken(JSON.parse(saRaw));
    let viFolder = cfg.viaticos_drive_folder_id as string | null;
    if (!viFolder) { viFolder = await ensureFolder(token, 'Viáticos', parent); await supa.from('configuracion').update({ viaticos_drive_folder_id: viFolder }).eq('id', 1); }
    const tecFolder = await ensureFolder(token, sani(tec?.nombre || 'Tecnico', 60), viFolder);
    let renFolder: string;
    if (g.rendicion_id) {
      const { data: ren } = await supa.from('rendiciones').select('titulo,drive_folder_id').eq('id', g.rendicion_id).single();
      renFolder = ren?.drive_folder_id as string;
      if (!renFolder) { renFolder = await ensureFolder(token, sani(ren?.titulo || 'Rendicion', 60), tecFolder); await supa.from('rendiciones').update({ drive_folder_id: renFolder }).eq('id', g.rendicion_id); }
    } else { renFolder = await ensureFolder(token, 'Sueltos', tecFolder); }

    const fecha = String(g.fecha_emision || g.creado || '').slice(0, 10);
    const cat = g.categoria || 'sin-categoria';
    const prov = sani(g.proveedor || g.entidad_pago || 'gasto', 30);
    const tot = g.total != null ? `${g.moneda === 'USD' ? 'USD' : 'S'}-${(+g.total).toFixed(2)}` : 'sin-total';
    const ext = String(g.mime || '').includes('png') ? 'png' : String(g.mime || '').includes('pdf') ? 'pdf' : 'jpg';
    const fname = `${fecha}_${cat}_${prov}_${tot}.${ext}`;

    // Si ya se subió antes (re-confirmación), solo renombra el archivo con los datos finales.
    if (g.drive_file_id) { await renameFile(token, g.drive_file_id, fname); return json({ ok: true, drive_url: g.drive_url, renombrado: true }); }
    const dl = await supa.storage.from('viaticos').download(g.imagen_path);
    if (dl.error || !dl.data) return json({ error: 'No se pudo leer la imagen.' }, 500);
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const up = await uploadFile(token, fname, g.mime || 'image/jpeg', bytes, renFolder);
    await supa.from('gastos').update({ drive_url: up.url, drive_file_id: up.id }).eq('id', gasto_id);
    return json({ ok: true, drive_url: up.url });
  } catch (e) { return json({ error: String((e as any)?.message || e) }, 500); }
});
