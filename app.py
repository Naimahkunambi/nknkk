# 🚀 KIBOKO YAO SNIPER TERMINAL 2.0 FINAL

import time
import math
import json
import requests
import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from datetime import datetime

# ================= SETTINGS =================
API_TOKEN = "kabW2n8VL3raHpF"   # ✅ Your Deriv API token here
APP_ID = "70487"                # ✅ Your App ID here

REAL_SIGNAL_URL = ""  # (for future real scanner integration)

AUTO_SCAN_ENABLED = False  # (for now using manual upload)

# ============== DERIV API WRAPPER ==============
import websocket

class DerivAPI:
    def __init__(self, token):
        self.token = token
        self.ws = None
        self.connect()

    def connect(self):
        url = f"wss://ws.derivws.com/websockets/v3?app_id={APP_ID}"
        self.ws = websocket.create_connection(url)
        self.ws.send(json.dumps({"authorize": self.token}))
        auth = json.loads(self.ws.recv())
        if 'error' in auth:
            raise Exception(f"Authorization Failed: {auth['error']['message']}")

    def place_order(self, symbol, action, stake=0.35):
        order = {
            "buy": 1,
            "price": 1.0,
            "parameters": {
                "amount": stake,
                "basis": "stake",
                "contract_type": "CALL" if action == "buy" else "PUT",
                "currency": "USD",
                "symbol": symbol,
                "duration": 5,
                "duration_unit": "t",
                "product_type": "basic"
            }
        }
        self.ws.send(json.dumps(order))
        response = json.loads(self.ws.recv())
        return response

# ============== STATE INIT ==============
if "manual_signals" not in st.session_state:
    st.session_state.manual_signals = []
if "open_trades" not in st.session_state:
    st.session_state.open_trades = []
if "closed_trades" not in st.session_state:
    st.session_state.closed_trades = []

api = DerivAPI(API_TOKEN)

# ================== MAIN PAGE =================
st.set_page_config(page_title="KIBOKO YAO 2.0", layout="wide")

st.sidebar.title("⚙️ Settings")
stake_amount = st.sidebar.number_input("Stake Amount ($)", 0.20, 5.00, step=0.05, value=0.35)

# ================== MANUAL SIGNAL UPLOAD =================
st.title("📈 KIBOKO YAO SNIPER TERMINAL 2.0")
st.subheader("✅ Upload Manual Signals")

uploaded_signals = st.text_area("Paste Your Manual Signals Here (Format Clean)")

if st.button("🛬 Upload Signals"):
    for block in uploaded_signals.split("--------------------------------------------------"):
        if "Symbol:" in block and "Signal:" in block:
            lines = block.strip().split("\n")
            symbol = lines[0].split(":")[1].strip()
            signal_type = lines[2].split(":")[1].strip()
            entry = float(lines[3].split(":")[1].strip())
            sl = float(lines[4].split(":")[1].strip())
            tp1 = float(lines[5].split(":")[1].strip())
            tp2 = float(lines[6].split(":")[1].strip())
            reason = "\n".join(lines[8:])
            st.session_state.manual_signals.append({
                "symbol": symbol,
                "signal": signal_type,
                "entry": entry,
                "sl": sl,
                "tp1": tp1,
                "tp2": tp2,
                "reason": reason,
                "accepted": False,
                "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "status": "waiting"
            })
    st.success("✅ Signals Uploaded Successfully!")

# ================== DISPLAY SIGNALS =================
st.header("📡 Active Signals")

for idx, sig in enumerate(st.session_state.manual_signals):
    if not sig['accepted']:
        with st.expander(f"Signal {idx+1} ➡️ {sig['symbol']} | {sig['signal']} @ {sig['entry']}"):
            st.write(sig['reason'])
            if st.button(f"✅ Accept Trade {idx+1}"):
                api.place_order(sig['symbol'], "buy" if "Buy" in sig['signal'] else "sell", stake=stake_amount)
                sig['accepted'] = True
                sig['status'] = "open"
                sig['open_price'] = sig['entry']
                st.session_state.open_trades.append(sig)
                st.success(f"Trade Accepted and Sent for {sig['symbol']}!")

# ================== OPEN TRADES =================
st.header("🔴 Open Trades Monitor")

if st.session_state.open_trades:
    for idx, trade in enumerate(st.session_state.open_trades):
        with st.expander(f"{trade['symbol']} - {trade['signal']} - {trade['status'].upper()}"):
            st.write(f"📈 Entry: {trade['entry']}")
            st.write(f"🛑 Stop Loss: {trade['sl']}")
            st.write(f"🎯 TP1: {trade['tp1']}")
            st.write(f"🎯 TP2: {trade['tp2']}")
            st.write(f"🕒 Entry Time: {trade['time']}")
            st.write("Status: 🟢 OPEN" if trade['status'] == "open" else "🔴 CLOSED")
else:
    st.info("📭 No Open Trades Yet.")

# ================== CLOSED TRADES =================
st.header("✅ Closed Trades (History)")

if st.session_state.closed_trades:
    closed_df = pd.DataFrame(st.session_state.closed_trades)
    st.dataframe(closed_df)
else:
    st.info("📭 No Closed Trades Yet.")

# ================ (OPTIONAL) AUTO SCANNER ================
if AUTO_SCAN_ENABLED:
    try:
        signal_response = requests.get(REAL_SIGNAL_URL)
        if signal_response.status_code == 200:
            # Parse and auto-push signals into manual_signals
            pass
    except:
        st.warning("⚠️ Auto Scanner not active.")

# =================== FOOTER ===================
st.caption("Made with ❤️ for KIBOKO YAO 2.0 Sniper Squad - 2025")

