# 🚀 Kiboko Yao Sniper 2.5
# ✅ Auto Scan 4H -> Confirm 15M -> Accept to Place Trade

import time
import json
import requests
import streamlit as st
from datetime import datetime
try:
    import websocket
except ImportError:
    import os
    os.system("pip install websocket-client")
    import websocket

# ========== SETTINGS ==========
API_TOKEN = st.secrets["DERIV_API_TOKEN"]
APP_ID = st.secrets["DERIV_APP_ID"]

SYMBOLS = ["R_10", "R_25", "R_50", "R_75", "R_100"]
BASE_URL = "wss://ws.binaryws.com/websockets/v3?app_id=" + APP_ID
REFRESH_INTERVAL = 15 * 60  # 15 minutes

# ========== API CLASS ==========
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
        print("✅ Authorized")

    def get_candles(self, symbol, count=100, timeframe=900):
        req = {
            "ticks_history": symbol,
            "end": "latest",
            "count": count,
            "style": "candles",
            "granularity": timeframe
        }
        self.ws.send(json.dumps(req))
        res = json.loads(self.ws.recv())
        if 'error' in res:
            raise Exception(f"API Error: {res['error']['message']}")
        return res.get('candles', [])

    def place_trade(self, symbol, action, amount):
        buy_type = "CALL" if action == "buy" else "PUT"
        req = {
            "buy": 1,
            "price": amount,
            "parameters": {
                "amount": amount,
                "basis": "stake",
                "contract_type": buy_type,
                "currency": "USD",
                "duration": 5,
                "duration_unit": "t",
                "symbol": symbol,
                "product_type": "basic"
            }
        }
        self.ws.send(json.dumps(req))
        res = json.loads(self.ws.recv())
        return res

# ========== DETECTOR CLASS ==========
class PatternDetector:
    def detect_engulfing(self, candles):
        signals = []
        for i in range(1, len(candles)):
            prev = candles[i - 1]
            curr = candles[i]
            if prev['close'] < prev['open'] and curr['close'] > curr['open']:
                signals.append(("buy", i))
            if prev['close'] > prev['open'] and curr['close'] < curr['open']:
                signals.append(("sell", i))
        return signals

def fib_levels(high, low):
    diff = high - low
    sl = high - 0.786 * diff
    tp1 = high + 0.272 * diff
    tp2 = high + 0.618 * diff
    return sl, tp1, tp2

# ========== GLOBAL STORAGE ==========
signals = []
open_trades = []

# ========== STREAMLIT DASH ==========
st.set_page_config(page_title="🚀 Kiboko Yao Sniper Terminal", layout="wide")
st.title("🚀 KIBOKO YAO SNIPER TERMINAL 2.5")

stake = st.sidebar.number_input("💵 Stake Amount ($)", min_value=0.2, value=0.35, step=0.01)
refresh_button = st.sidebar.button("🔄 Manual Refresh Scanner")

api = DerivAPI(API_TOKEN)
detector = PatternDetector()

# ========== SCAN FUNCTION ==========
def scan_market():
    global signals
    signals = []
    for sym in SYMBOLS:
        candles_4h = api.get_candles(sym, count=50, timeframe=14400)
        if not candles_4h:
            continue
        engulf_4h = detector.detect_engulfing(candles_4h)
        if engulf_4h:
            last_signal, idx = engulf_4h[-1]
            last_candle_4h = candles_4h[idx]
            # Now Confirm on 15M
            candles_15m = api.get_candles(sym, count=50, timeframe=900)
            last_15m = candles_15m[-1]
            signal_info = {
                "symbol": sym,
                "type": last_signal,
                "entry": last_15m['close'],
                "sl": last_15m['high'] if last_signal == "sell" else last_15m['low'],
                "tp1": last_15m['close'] + 3 if last_signal == "buy" else last_15m['close'] - 3,
                "tp2": last_15m['close'] + 6 if last_signal == "buy" else last_15m['close'] - 6,
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
            signals.append(signal_info)

# ========== DISPLAY SIGNALS ==========
def show_signals():
    if signals:
        for idx, sig in enumerate(signals):
            col1, col2 = st.columns([3,1])
            with col1:
                st.markdown(f"**{sig['symbol']} | {sig['type'].upper()}**")
                st.markdown(f"🎯 Entry: {sig['entry']} | 🛡 SL: {sig['sl']} | 🏁 TP1: {sig['tp1']} | 🏁 TP2: {sig['tp2']}")
                st.caption(f"Detected: {sig['timestamp']}")
            with col2:
                if st.button(f"✅ Accept {idx}", key=f"accept_{idx}"):
                    place_trade(sig)

# ========== PLACE TRADE ==========
def place_trade(sig):
    try:
        res = api.place_trade(sig['symbol'], sig['type'], stake)
        open_trades.append({
            "symbol": sig['symbol'],
            "type": sig['type'],
            "entry": sig['entry'],
            "sl": sig['sl'],
            "tp1": sig['tp1'],
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
        st.success(f"🚀 Trade Placed: {sig['symbol']} {sig['type'].upper()}")
    except Exception as e:
        st.error(f"❌ Trade Error: {e}")

# ========== DISPLAY OPEN TRADES ==========
def show_open_trades():
    st.header("📈 Active Trades")
    if open_trades:
        for trade in open_trades:
            st.info(f"{trade['symbol']} {trade['type'].upper()} | Entry: {trade['entry']} | TP1: {trade['tp1']} | SL: {trade['sl']}")
    else:
        st.warning("No open trades yet.")

# ========== MAIN LOOP ==========
if refresh_button or (len(signals) == 0):
    scan_market()

show_signals()
show_open_trades()
