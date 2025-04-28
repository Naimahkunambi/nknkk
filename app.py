# 🚀 Kiboko Yao Sniper 2.0 (Manual Signal + Real Deriv Trading)
import streamlit as st
import requests
import websocket
import json
import pandas as pd
import plotly.graph_objects as go
import time

# ========== SETTINGS ==========
st.set_page_config(page_title="Kiboko Yao Sniper 2.0", layout="wide")

API_TOKEN = st.secrets["DERIV_API_TOKEN"]
APP_ID = st.secrets["DERIV_APP_ID"]

# ========== API CONNECTOR ==========
class DerivAPI:
    def __init__(self, token, app_id):
        self.token = token
        self.app_id = app_id
        self.ws = None
        self.connect()

    def connect(self):
        url = f"wss://ws.binaryws.com/websockets/v3?app_id={self.app_id}&token={self.token}"
        self.ws = websocket.create_connection(url)
        auth = json.loads(self.ws.recv())
        if "error" in auth:
            raise Exception(f"Authorization Failed: {auth['error']['message']}")

    def place_market_order(self, symbol, action, stake=0.20):
        order = {
            "buy": 1,
            "price": 1,
            "parameters": {
                "amount": stake,
                "basis": "stake",
                "contract_type": "CALL" if action == "BUY" else "PUT",
                "currency": "USD",
                "symbol": symbol,
                "duration": 5,
                "duration_unit": "t",
                "product_type": "basic"
            }
        }
        self.ws.send(json.dumps(order))
        response = json.loads(self.ws.recv())
        if "error" in response:
            return f"Error: {response['error']['message']}"
        else:
            return f"Success: {action} order placed for {symbol}"

# ========== STATE ==========
if "signals" not in st.session_state:
    st.session_state.signals = []

if "open_trades" not in st.session_state:
    st.session_state.open_trades = []

if "trade_history" not in st.session_state:
    st.session_state.trade_history = []

# ========== SIDEBAR ==========
st.sidebar.title("⚙️ Settings")
stake_amount = st.sidebar.number_input("Stake Amount ($)", value=0.20, step=0.01)
refresh_interval = st.sidebar.selectbox("Refresh Speed", ["🔥 Fast (30s)", "⚡ Normal (1min)", "💤 Slow (5min)"], index=1)

refresh_mapping = {
    "🔥 Fast (30s)": 30,
    "⚡ Normal (1min)": 60,
    "💤 Slow (5min)": 300
}
REFRESH_SECONDS = refresh_mapping[refresh_interval]

st.sidebar.markdown("---")
st.sidebar.markdown("✅ Kiboko Yao Sniper 2.0")
st.sidebar.markdown("Built for Real Trading.")

# ========== MAIN DASHBOARD ==========
st.title("🚀 Kiboko Yao Sniper 2.0 Terminal")

tabs = st.tabs(["📥 Signals", "📊 Trade Monitor", "📚 Journal"])

# 📥 Signals Tab
with tabs[0]:
    st.header("📥 Incoming Signals")

    manual_signal = st.text_area("Paste your manual signals here (JSON format):", height=200)
    if st.button("Upload Signals"):
        try:
            parsed = json.loads(manual_signal)
            st.session_state.signals.extend(parsed)
            st.success("✅ Signals Uploaded Successfully")
        except Exception as e:
            st.error(f"Invalid JSON Format: {e}")

    for idx, signal in enumerate(st.session_state.signals):
        col1, col2, col3 = st.columns([3,2,2])
        with col1:
            st.subheader(signal["symbol"])
            st.write(f"**Type:** {signal['signal_type']}")
            st.write(f"**Entry:** {signal['entry']}")
            st.write(f"**SL:** {signal['sl']}")
            st.write(f"**TP1:** {signal['tp1']}")
            st.write(f"**TP2:** {signal['tp2']}")
            st.write(f"**Reason:** {signal['reason']}")
        with col2:
            if st.button(f"✅ Accept {signal['symbol']}", key=f"accept_{idx}"):
                api = DerivAPI(API_TOKEN, APP_ID)
                direction = "BUY" if signal["signal_type"].lower().startswith("buy") else "SELL"
                result = api.place_market_order(symbol=signal["symbol"], action=direction, stake=stake_amount)
                st.success(result)
                trade_record = {
                    "symbol": signal["symbol"],
                    "entry": signal["entry"],
                    "sl": signal["sl"],
                    "tp1": signal["tp1"],
                    "tp2": signal["tp2"],
                    "signal_type": signal["signal_type"],
                    "status": "OPEN",
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "direction": direction
                }
                st.session_state.open_trades.append(trade_record)
                st.session_state.trade_history.append(trade_record)
                st.session_state.signals.pop(idx)
                st.experimental_rerun()

# 📊 Trade Monitor Tab
with tabs[1]:
    st.header("📊 Live Trades Monitor")
    if st.session_state.open_trades:
        df_open = pd.DataFrame(st.session_state.open_trades)
        st.dataframe(df_open, use_container_width=True)
    else:
        st.info("No Active Trades.")

# 📚 Journal Tab
with tabs[2]:
    st.header("📚 Full Trade Journal")
    if st.session_state.trade_history:
        df_journal = pd.DataFrame(st.session_state.trade_history)
        st.dataframe(df_journal, use_container_width=True)
    else:
        st.info("No Trades Recorded Yet.")

# ========== AUTO REFRESH ==========
st.experimental_rerun()
time.sleep(REFRESH_SECONDS)
