const CLIENT_ID = '345Q6O96H6J8ANmWhmGkX';
const REDIRECT_URI = 'https://sani-arb.vercel.app/callback';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { code, codeVerifier, redirectUri } = req.body || {};
    if (!code || !codeVerifier || redirectUri !== REDIRECT_URI) return res.status(400).json({ error: 'Invalid OAuth exchange request.' });

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
    });

    const response = await fetch('https://auth.deriv.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      return res.status(response.status || 502).json({ error: data.error_description || data.error || 'Deriv token exchange failed.' });
    }

    const maxAge = Math.max(60, Math.min(Number(data.expires_in) || 3600, 3600) - 60);
    res.setHeader('Set-Cookie', `sani_deriv_token=${encodeURIComponent(data.access_token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
    return res.status(200).json({ ok: true, expiresIn: maxAge });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'OAuth exchange failed.' });
  }
}
