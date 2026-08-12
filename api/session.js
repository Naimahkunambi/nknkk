const APP_ID = '345Q6O96H6J8ANmWhmGkX';
const API_BASE = 'https://api.derivws.com';

function tokenFrom(req) {
  const raw = req.headers.cookie || '';
  const pair = raw.split(';').map(v => v.trim()).find(v => v.startsWith('sani_deriv_token='));
  return pair ? decodeURIComponent(pair.slice('sani_deriv_token='.length)) : '';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const token = tokenFrom(req);
  if (!token) return res.status(401).json({ authenticated: false });

  try {
    const response = await fetch(`${API_BASE}/trading/v1/options/accounts`, {
      headers: { 'Deriv-App-ID': APP_ID, 'Authorization': `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      res.setHeader('Set-Cookie', 'sani_deriv_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      return res.status(response.status).json({ authenticated: false, error: body?.errors?.[0]?.message || 'Session expired.' });
    }

    const rows = Array.isArray(body.data) ? body.data : (body.data ? [body.data] : []);
    const demo = rows.find(a => String(a.account_type).toLowerCase() === 'demo');
    if (!demo) return res.status(404).json({ authenticated: true, error: 'No demo Options account found.' });

    return res.status(200).json({
      authenticated: true,
      demoAccount: {
        account_id: demo.account_id,
        account_type: demo.account_type,
        currency: demo.currency,
        balance: demo.balance,
        status: demo.status,
      },
    });
  } catch (error) {
    return res.status(500).json({ authenticated: false, error: error.message || 'Could not load Deriv accounts.' });
  }
}
