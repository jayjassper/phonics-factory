// netlify/functions/scores.js
// Proxy ระหว่างเกม HTML กับ Supabase — ซ่อน key ไว้ฝั่ง server
// Deploy: วางไฟล์นี้ใน netlify/functions/ แล้ว push ขึ้น Netlify

const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY;
const TABLE         = 'scores';

const headers = (origin) => ({
  'Content-Type':                'application/json',
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
});

// ── helper: call Supabase REST API ──────────────────────────────────────────
async function supabase(method, params = '', body = null) {
  const url = `${SUPABASE_URL}/rest/v1/${TABLE}${params}`;
  const res  = await fetch(url, {
    method,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        method === 'POST' ? 'resolution=merge-duplicates,return=representation' : 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : [];
  return { ok: res.ok, status: res.status, data };
}

// ── main handler ─────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const origin  = event.headers?.origin || '*';
  const method  = event.httpMethod;

  // CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: headers(origin), body: '' };
  }

  // ── GET /scores — ดึงคะแนนทั้งหมดสำหรับ Admin dashboard ──
  if (method === 'GET') {
    const { ok, status, data } = await supabase('GET', '?order=score.desc&limit=100');
    if (!ok) return { statusCode: status, headers: headers(origin), body: JSON.stringify({ error: data }) };
    return { statusCode: 200, headers: headers(origin), body: JSON.stringify(data) };
  }

  // ── POST /scores — บันทึก/อัปเดตคะแนนนักเรียน ──
  if (method === 'POST') {
    let payload;
    try { payload = JSON.parse(event.body); } 
    catch { return { statusCode: 400, headers: headers(origin), body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const { name, score, level, badges, date, feedback } = payload;
    if (!name) return { statusCode: 400, headers: headers(origin), body: JSON.stringify({ error: 'name required' }) };

    // ตรวจว่ามีชื่อนี้แล้วหรือยัง
    const check = await supabase('GET', `?name=eq.${encodeURIComponent(name)}&limit=1`);
    const existing = check.data?.[0];

    let result;
    if (existing) {
      // PATCH — อัปเดตเฉพาะ score ที่สูงกว่า
      if ((score ?? 0) >= (existing.score ?? 0)) {
        result = await supabase('PATCH', `?name=eq.${encodeURIComponent(name)}`, {
          score: score ?? existing.score,
          level: level ?? existing.level,
          badges: badges ?? existing.badges,
          date,
          updated_at: new Date().toISOString(),
        });
      } else {
        // score ต่ำกว่าเดิม — ไม่อัปเดต แต่ส่ง ok กลับ
        result = { ok: true, status: 200, data: [existing] };
      }
    } else {
      // INSERT ใหม่
      result = await supabase('POST', '', { name, score: score ?? 0, level: level ?? 1, badges: badges ?? '', date, feedback: feedback ?? '' });
    }

    if (!result.ok) return { statusCode: result.status, headers: headers(origin), body: JSON.stringify({ error: result.data }) };
    return { statusCode: 200, headers: headers(origin), body: JSON.stringify(result.data) };
  }

  // ── PATCH /scores?action=feedback — ครูเพิ่ม feedback ──
  if (method === 'PATCH') {
    let payload;
    try { payload = JSON.parse(event.body); } 
    catch { return { statusCode: 400, headers: headers(origin), body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const { name, feedback } = payload;
    if (!name) return { statusCode: 400, headers: headers(origin), body: JSON.stringify({ error: 'name required' }) };

    const result = await supabase('PATCH', `?name=eq.${encodeURIComponent(name)}`, { feedback, updated_at: new Date().toISOString() });
    if (!result.ok) return { statusCode: result.status, headers: headers(origin), body: JSON.stringify({ error: result.data }) };
    return { statusCode: 200, headers: headers(origin), body: JSON.stringify(result.data) };
  }

  return { statusCode: 405, headers: headers(origin), body: JSON.stringify({ error: 'Method not allowed' }) };
};
