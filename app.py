# 🚀 Kiboko Yao Sniper Terminal 2.0 Final

import streamlit as st
import requests
import json
import time
from datetime import datetime
import pandas as pd
import plotly.graph_objects as go
import websocket
import threading

# =========================
# SETTINGS (YOUR INFO)
# =========================
API_TOKEN = "kabW2n8VL3raHpF"  # Your Deriv API Token
APP_ID = "70487"               # Your App ID
SIGNAL_URL = "https://your-fastapi-signal-server.com/signals"  # Your FastAPI server URL
STAKE = 0.20  # Starting $ per trade

# =========================
# GLOBAL STORAGE
# =========================
open_trades = []
closed_trades = []
sniper_signals = []

# =========================
# API Connection to Deriv
# =========================
class DerivAPI:
    def __init__(self, token, app_id):
        self.token = token
        self.app_id = app_id
        self.ws = None
        self.connect()

    def connect(self):
        self.ws = websocket.create_connection(f"wss://ws.binaryws.com/websockets/v3?app_id={self.app_id}")
        self.ws.send(json.dumps({"authorize": self.token}))
        auth = json.loads(self.ws.recv())
        if 'error' in auth:
            raise Exception(f"Authorization Failed: {auth['error']['message']}")

    def place_market_order(self, symbol, action, stake):
        contract_type = "CALL" if action == "BUY" else "PUT"
        order = {
            "buy": 1,
            "price": stake,
            "parameters": {
                "amount": stake,
                "basis": "stake",
                "contract_type": contract_type,
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

# =========================
# FETCH SIGNALS FROM SERVER
# =========================
def fetch_sniper_signals():
    try:
        response = requests.get(SIGNAL_URL)
        if response.status_code == 200:
            return response.json()["signals"]
    except Exception as e:
        st.error(f"Signal Fetch Error: {e}")
    return []

# =========================
# LIVE TRADE STATUS MONITOR
# =========================
def update_trade_status():
    for trade in open_trades[:]:
        now_price = fetch_symbol_price(trade['symbol'])
        if trade['direction'] == "BUY":
            if now_price >= trade['tp1']:
                closed_trades.append({**trade, "result": "Win"})
                open_trades.remove(trade)
            elif now_price <= trade['sl']:
                closed_trades.append({**trade, "result": "Loss"})
                open_trades.remove(trade)
        else:
            if now_price <= trade['tp1']:
                closed_trades.append({**trade, "result": "Win"})
                open_trades.remove(trade)
            elif now_price >= trade['sl']:
                closed_trades.append({**trade, "result": "Loss"})
                open_trades.remove(trade)

def fetch_symbol_price(symbol):
    try:
        api_url = f"https://api.deriv.com/api/v1/active_symbols"
        response = requests.get(api_url)
        data = response.json()
        for sym in data["active_symbols"]:
            if sym["symbol"] == symbol:
                return sym["spot"]
    except:
        pass
    return None

# =========================
# STREAMLIT UI
# =========================
st.set_page_config(page_title="🚀 Kiboko Yao Sniper 2.0", layout="wide")
st.title("🚀 Kiboko Yao Sniper 2.0 Terminal")

col1, col2 = st.columns(2)

with col1:
    st.header("🛰 Live Signals")
    st.write("Automatically fetched every 1 hour.")

    for signal in sniper_signals:
        with st.expander(f"🛡 {signal['symbol']} | {signal['signal_type']}"):
            st.metric("Entry Price", signal['entry'])
            st.metric("Stop Loss", signal['sl'])
            st.metric("TP1", signal['tp1'])
            st.metric("TP2", signal['tp2'])
            st.text(signal['reason'])
            if st.button(f"✅ Accept Trade ({signal['symbol']})"):
                deriv.place_market_order(signal['symbol'], "BUY" if signal['signal_type'] == "Buy Stop" else "SELL", STAKE)
                open_trades.append({
                    "symbol": signal['symbol'],
                    "direction": "BUY" if signal['signal_type'] == "Buy Stop" else "SELL",
                    "entry": signal['entry'],
                    "sl": signal['sl'],
                    "tp1": signal['tp1'],
                    "tp2": signal['tp2'],
                    "open_time": datetime.now()
                })

with col2:
    st.header("📊 Open Trades")
    if open_trades:
        df = pd.DataFrame(open_trades)
        st.dataframe(df)
    else:
        st.info("No active trades yet.")

    st.header("🏆 Closed Trades")
    if closed_trades:
        df_closed = pd.DataFrame(closed_trades)
        st.dataframe(df_closed)
    else:
        st.info("No closed trades yet.")

# =========================
# BACKGROUND UPDATER
# =========================
def sniper_background():
    global sniper_signals
    while True:
        sniper_signals = fetch_sniper_signals()
        update_trade_status()
        time.sleep(3600)  # refresh every hour

if 'thread_started' not in st.session_state:
    deriv = DerivAPI(API_TOKEN, APP_ID)
    threading.Thread(target=sniper_background, daemon=True).start()
    st.session_state['thread_started'] = True

