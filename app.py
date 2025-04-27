
# 🚀 KIBOKO YAO SNIPER TERMINAL 2.0 FINAL
# Full Web App: Scanner + Signal Log + Buy/Sell + Trade Tracker

import time
import json
import os
import requests
import streamlit as st
from datetime import datetime

try:
    import websocket
except ImportError:
    os.system('pip install websocket-client')
    import websocket

# ================================ SETTINGS =================================
API_TOKEN = os.getenv("DERIV_API_TOKEN")
APP_ID = os.getenv("DERIV_APP_ID", "70487")
BASE_URL = "wss://ws.binaryws.com/websockets/v3?app_id=" + APP_ID

SYMBOLS = ["R_10", "R_25", "R_50", "R_75", "R_100", "BOOM1000INDEX", "CRASH1000INDEX", "STEPINDEX"]
TIMEFRAME = 900  # 15 minutes
TRADE_SIZE = 0.20  # USD per trade

# ================================ INIT STATE ================================
signals = []
open_trades = []
trade_history = []

# ================================ API CONNECTION ============================
class DerivAPI:
    def __init__(self, token):
        self.token = token
        self.ws = None
        self.connect()

    def connect(self):
        self.ws = websocket.create_connection(BASE_URL)
        self.ws.send(json.dumps({"authorize": self.token}))
        auth = json.loads(self.ws.recv())
        if 'error' in auth:
            raise Exception(f"Authorization Failed: {auth['error']['message']}")

    def get_candles(self, symbol, count=100, timeframe=900):
        self.ws.send(json.dumps({
            "ticks_history": symbol,
            "end": "latest",
            "count": count,
            "style": "candles",
            "granularity": timeframe
        }))
        data = json.loads(self.ws.recv())
        return data.get("candles", [])

# ================================ DETECTION LOGIC ===========================
def detect_sniper_signals(candles):
    highs = [candle['high'] for candle in candles]
    lows = [candle['low'] for candle in candles]
    last = candles[-1]
    prev = candles[-2]

    signal = None

    if prev['close'] < prev['open'] and last['close'] > last['open'] and last['close'] > prev['open']:
        sl, tp1, tp2 = fib_levels(last['close'], min(lows[-5:]))
        signal = ('BUY', last['close'], sl, tp1, tp2)
    elif prev['close'] > prev['open'] and last['close'] < last['open'] and last['close'] < prev['open']:
        sl, tp1, tp2 = fib_levels(max(highs[-5:]), last['close'])
        signal = ('SELL', last['close'], sl, tp1, tp2)

    return signal

def fib_levels(high, low):
    diff = high - low
    sl = high - 0.786 * diff
    tp1 = low - 0.272 * diff
    tp2 = low - 0.618 * diff
    return sl, tp1, tp2

# ================================ STREAMLIT FRONTEND =========================

st.set_page_config(page_title="KIBOKO YAO SNIPER", layout="wide")
st.title("🚀 KIBOKO YAO SNIPER TERMINAL 2.0")

api = DerivAPI(API_TOKEN)

if st.button("🔎 Start Scanning (Manual Refresh)"):
    for symbol in SYMBOLS:
        candles = api.get_candles(symbol)
        if not candles:
            continue

        signal = detect_sniper_signals(candles)
        if signal:
            signal_type, entry, sl, tp1, tp2 = signal
            signals.append({
                "symbol": symbol,
                "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "signal": signal_type,
                "entry": round(entry, 2),
                "sl": round(sl, 2),
                "tp1": round(tp1, 2),
                "tp2": round(tp2, 2)
            })

st.subheader("📈 Current Sniper Signals")
for idx, s in enumerate(signals):
    col1, col2, col3 = st.columns([2, 2, 6])
    col1.metric(label="Symbol", value=s['symbol'])
    col2.metric(label="Signal", value=s['signal'])
    with col3:
        st.write(f"Entry: {s['entry']}, SL: {s['sl']}, TP1: {s['tp1']}, TP2: {s['tp2']}")
        trade_action = st.selectbox(f"Action {idx+1}", ("None", "BUY", "SELL"))
        if st.button(f"Execute {trade_action} {idx+1}") and trade_action in ["BUY", "SELL"]:
            open_trades.append({
                **s,
                "action": trade_action,
                "status": "OPEN"
            })
            trade_history.append({
                **s,
                "action": trade_action,
                "status": "OPEN"
            })
            st.success(f"✅ Executed {trade_action} on {s['symbol']}")

st.subheader("📦 Open Trades")
if open_trades:
    for t in open_trades:
        st.write(f"{t['symbol']} | {t['action']} at {t['entry']} | SL: {t['sl']} | TP1: {t['tp1']}")

st.subheader("📜 Trade History")
if trade_history:
    for t in trade_history:
        st.write(f"{t['time']} | {t['symbol']} | {t['action']} | Entry: {t['entry']} | Status: {t['status']}")

st.info("App auto refreshes when you click 'Start Scanning'!")
