const APP_ID = '345Q6O96H6J8ANmWhmGkX';
const API_BASE = 'https://api.derivws.com';

function tokenFrom(req) {
  const raw = req.headers.cookie || '';
  const pair = raw.split(';').map(v => v.trim()).find(v => v.startsWith('sani_deriv_token='));
  return pair ? decodeURIComponent(pair.slice('sani_deriv_token='.length)) : '';
}

async function derivFetch(path, token, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Deriv-App-ID': APP_ID,
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const token = tokenFrom(req);
  if (!token) return res.status(401).json({ error: 'Login with Deriv first.' });

  try {
    const accountsResponse = await derivFetch('/trading/v1/options/accounts', token);
    const accountsBody = await accountsResponse.json().catch(() => ({}));
    if (!accountsResponse.ok) return res.status(accountsResponse.status).json({ error: accountsBody?.errors?.[0]?.message || 'Could not load accounts.' });

    const rows = Array.isArray(accountsBody.data) ? accountsBody.data : (accountsBody.data ? [accountsBody.data] : []);
    const demo = rows.find(a => String(a.account_type).toLowerCase() === 'demo');
    if (!demo?.account_id) return res.status(404).json({ error: 'No demo Options account found.' });

    const otpResponse = await derivFetch(`/trading/v1/options/accounts/${encodeURIComponent(demo.account_id)}/otp`, token, { method: 'POST' });
    const otpBody = await otpResponse.json().catch(() => ({}));
    if (!otpResponse.ok) return res.status(otpResponse.status).json({ error: otpBody?.errors?.[0]?.message || 'Demo OTP request failed.' });

    const url = otpBody?.data?.url;
    if (!url || !url.includes('/ws/demo')) return res.status(502).json({ error: 'Safety lock rejected a non-demo WebSocket URL.' });
    return res.status(200).json({ url, accountId: demo.account_id });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Could not create demo WebSocket session.' });
  }
}
