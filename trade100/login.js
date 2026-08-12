const CLIENT_ID='345Q6O96H6J8ANmWhmGkX';
const REDIRECT='https://sani-arb.vercel.app/callback';
const loginBtn=document.getElementById('trade100Login');

function b64(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}

async function beginLogin(){
  const random=crypto.getRandomValues(new Uint8Array(64));
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const verifier=Array.from(random,x=>alphabet[x%alphabet.length]).join('');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  const challenge=b64(new Uint8Array(digest));
  const state=Array.from(crypto.getRandomValues(new Uint8Array(24)),x=>x.toString(16).padStart(2,'0')).join('');
  sessionStorage.setItem('sani_pkce_verifier',verifier);
  sessionStorage.setItem('sani_oauth_state',state);
  sessionStorage.setItem('sani_return_to','/trade100/');
  const p=new URLSearchParams({response_type:'code',client_id:CLIENT_ID,redirect_uri:REDIRECT,scope:'trade',state,code_challenge:challenge,code_challenge_method:'S256'});
  location.assign(`https://auth.deriv.com/oauth2/auth?${p}`);
}

async function finishLogin(){
  const p=new URLSearchParams(location.search);
  if(!p.get('code')&&!p.get('error'))return false;
  if(p.get('error'))throw Error(p.get('error_description')||p.get('error'));
  const code=p.get('code');
  const returned=p.get('state');
  const expected=sessionStorage.getItem('sani_oauth_state');
  const verifier=sessionStorage.getItem('sani_pkce_verifier');
  if(!code||returned!==expected||!verifier)throw Error('OAuth validation failed. Please login again.');
  const r=await fetch('/api/oauth-exchange',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({code,codeVerifier:verifier,redirectUri:REDIRECT})});
  const b=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(b.error||'Deriv login failed.');
  sessionStorage.removeItem('sani_pkce_verifier');
  sessionStorage.removeItem('sani_oauth_state');
  sessionStorage.removeItem('sani_return_to');
  history.replaceState({},'', '/trade100/');
  location.reload();
  return true;
}

if(loginBtn) loginBtn.addEventListener('click',()=>beginLogin().catch(e=>{loginBtn.textContent='Login failed. Try again';console.error(e)}));

(async()=>{
  try{
    const completed=await finishLogin();
    if(completed)return;
    const r=await fetch('/api/session',{credentials:'same-origin'});
    const b=await r.json().catch(()=>({}));
    if(loginBtn){
      if(r.ok&&b.authenticated&&b.demoAccount){loginBtn.textContent='Deriv Demo Logged In';loginBtn.disabled=true}
      else {loginBtn.textContent='Login with Deriv';loginBtn.disabled=false}
    }
  }catch(e){
    if(loginBtn){loginBtn.textContent='Login with Deriv';loginBtn.disabled=false}
    console.error(e);
  }
})();