# 🚀 Kiboko Yao 2.0 - Manual Signal Paste Mode - Full app.py
import streamlit as st
import json
import re
import requests
from datetime import datetime

# ========== HARDCODED CREDENTIALS ==========
API_TOKEN = "YOUR_DERIV_API_TOKEN"
APP_ID = "YOUR_APP_ID"

# ========== GLOBALS ==========
BASE_URL = "wss://ws.binaryws.com/websockets/v3?app_id=" + APP_ID
LIVE_TRADES = []

# ========== FUNCTIONS ==========
def parse_signals(text):
    signals = []
    blocks = text.split('--------------------------------------------------')
    for block in blocks:
        try:
            symbol = re.search(r'Symbol:\s*(\w+)', block).group(1)
            signal_type = re.search(r'Signal:\s*(.+)', block).group(1)
            entry = float(re.search(r'Entry:\s*(\d+\.\d+)', block).group(1))
            sl = float(re.search(r'Stop Loss.*?:\s*(\d+\.\d+)', block).group(1))
            tp1 = float(re.search(r'TP1.*?:\s*(\d+\.\d+)', block).group(1))
            tp2 = float(re.search(r'TP2.*?:\s*(\d+\.\d+)', block).group(1))
            reason = re.search(r'Reason for Trade:\n- (.+)', block).group(1)

            signals.append({
                'symbol': symbol,
                'entry': entry,
                'sl': sl,
                'tp1': tp1,
                'tp2': tp2,
                'signal_type': signal_type,
                'reason': reason,
                'timestamp': datetime.utcnow().isoformat()
            })
        except:
            pass
    return signals


def place_trade(symbol, direction, amount=0.35):
    try:
        url = f"https://api.deriv.com/binary/v3"
        payload = {
            "buy": 1,
            "price": amount,
            "parameters": {
                "amount": amount,
                "basis": "stake",
                "contract_type": "CALL" if direction == "buy" else "PUT",
                "currency": "USD",
                "symbol": symbol,
                "duration": 5,
                "duration_unit": "t",
                "product_type": "basic"
            }
        }
        # Simulation only: in real, place order via websocket with authorized token
        print(f"Order Placed: {payload}")
    except Exception as e:
        st.error(f"Trade placement failed: {e}")


# ========== STREAMLIT UI ==========
st.set_page_config(page_title="Kiboko Yao 2.0 - Manual Signals", layout="wide")
st.title("📈 Kiboko Yao Manual Signal Dashboard")

st.sidebar.header("Paste Signals Below")
signal_text = st.sidebar.text_area("Paste your fresh sniper signals here:", height=400)

if st.sidebar.button("Load Signals"):
    if signal_text.strip() != "":
        parsed_signals = parse_signals(signal_text)
        st.session_state['parsed_signals'] = parsed_signals
        st.success("✅ Signals Loaded Successfully!")
    else:
        st.warning("⚠️ Please paste your signals before loading.")

if 'parsed_signals' not in st.session_state:
    st.session_state['parsed_signals'] = []

st.write("# 🛡️ Active Signals")

for idx, sig in enumerate(st.session_state['parsed_signals']):
    col1, col2 = st.columns([5, 1])

    with col1:
        st.info(f"""
        **Symbol**: {sig['symbol']}   
        **Signal**: {sig['signal_type']}   
        **Entry**: {sig['entry']}   
        **SL**: {sig['sl']}   
        **TP1**: {sig['tp1']}   
        **TP2**: {sig['tp2']}   
        **Reason**: {sig['reason']}   
        **Generated**: {sig['timestamp']} UTC
        """, icon="🚀")

    with col2:
        if st.button(f"✅ Accept {sig['symbol']}", key=f"accept_{idx}"):
            direction = "buy" if "buy" in sig['signal_type'].lower() else "sell"
            place_trade(sig['symbol'], direction)
            LIVE_TRADES.append({**sig, 'accepted_time': datetime.utcnow().isoformat()})
            st.success(f"✅ Trade Accepted and Executed for {sig['symbol']}!")

st.divider()
st.write("# 📜 Trade Journal")
if len(LIVE_TRADES) == 0:
    st.warning("No trades accepted yet.")
else:
    for trade in LIVE_TRADES:
        st.success(f"{trade['symbol']} - {trade['signal_type']} @ {trade['entry']} | Accepted at {trade['accepted_time']} UTC")
