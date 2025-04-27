import streamlit as st
import websocket
import json
import pandas as pd
from datetime import datetime

# === DERIV API CONNECTION ===
class DerivAPI:
    def __init__(self, token):
        self.token = token
        self.ws = None
        self.connect()

    def connect(self):
        url = f"wss://ws.binaryws.com/websockets/v3?app_id=70487"
        self.ws = websocket.create_connection(url)
        self.ws.send(json.dumps({"authorize": self.token}))
        response = json.loads(self.ws.recv())
        if 'error' in response:
            raise Exception(f"Authorization Failed: {response['error']['message']}")
        print("✅ Connected to Deriv")

    def get_candles(self, symbol, count=200, timeframe=900):
        request = {
            "ticks_history": symbol,
            "end": "latest",
            "count": count,
            "style": "candles",
            "granularity": timeframe
        }
        self.ws.send(json.dumps(request))
        response = json.loads(self.ws.recv())
        if 'error' in response:
            raise Exception(f"Error: {response['error']['message']}")
        return response.get('candles', [])

    def place_order(self, symbol, action, stake):
        contract_type = "CALL" if action == "buy" else "PUT"
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
                "duration_unit": "m",
                "product_type": "basic"
            }
        }
        self.ws.send(json.dumps(order))
        response = json.loads(self.ws.recv())
        return response

# === Initialize Session States ===
if "active_trades" not in st.session_state:
    st.session_state.active_trades = []
if "trade_history" not in st.session_state:
    st.session_state.trade_history = []

# === Settings Sidebar ===
st.sidebar.title("⚙️ Settings")
api_token = st.sidebar.text_input("🔑 Deriv API Token", type="password")
stake_amount = st.sidebar.number_input("💵 Stake Amount", min_value=0.20, value=0.20, step=0.01)

st.title("🚀 KIBOKO YAO SNIPER TERMINAL 2.0")

# === Connect to Deriv ===
if api_token:
    api = DerivAPI(api_token)

    # === Incoming Signal Manual Section ===
    st.header("📡 Incoming Sniper Signals (Manual Accept)")

    selected_symbol = st.selectbox("📈 Select Symbol", ["R_10", "R_25", "R_50", "R_75", "R_100"])
    signal_type = st.selectbox("🎯 Signal Type", ["Buy Stop", "Sell Stop"])
    entry_price = st.number_input("🎯 Entry Price", min_value=0.01)
    stop_loss = st.number_input("🛡 Stop Loss", min_value=0.01)
    tp1 = st.number_input("🎯 TP1", min_value=0.01)
    tp2 = st.number_input("🎯 TP2", min_value=0.01)

    if st.button("✅ Accept Trade and Place Order"):
        action = "buy" if signal_type == "Buy Stop" else "sell"
        trade_response = api.place_order(selected_symbol, action, stake_amount)
        st.success(f"✅ Real Trade Placed on {selected_symbol}!")
        st.json(trade_response)

        new_trade = {
            "symbol": selected_symbol,
            "action": action.upper(),
            "stake": stake_amount,
            "entry_price": entry_price,
            "sl": stop_loss,
            "tp1": tp1,
            "tp2": tp2,
            "status": "Running",
            "opened_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        st.session_state.active_trades.append(new_trade)

    # === Active Trades Monitor ===
    st.header("📋 Active Trades Monitor")

    if st.session_state.active_trades:
        updated_trades = []
        completed_trades = []

        for trade in st.session_state.active_trades:
            try:
                latest_candle = api.get_candles(trade["symbol"], count=1, timeframe=900)[-1]
                live_price = latest_candle['close']
            except Exception as e:
                st.error(f"⚠️ Error fetching live price for {trade['symbol']}: {e}")
                continue

            if trade["action"] == "BUY":
                if live_price >= trade["tp1"]:
                    trade["status"] = "Win (TP1 Hit!) 🟢"
                elif live_price <= trade["sl"]:
                    trade["status"] = "Loss (SL Hit!) 🔴"
            elif trade["action"] == "SELL":
                if live_price <= trade["tp1"]:
                    trade["status"] = "Win (TP1 Hit!) 🟢"
                elif live_price >= trade["sl"]:
                    trade["status"] = "Loss (SL Hit!) 🔴"

            if "Win" in trade["status"] or "Loss" in trade["status"]:
                completed_trades.append(trade)
            else:
                updated_trades.append(trade)

        st.session_state.active_trades = updated_trades
        st.session_state.trade_history.extend(completed_trades)

        if updated_trades:
            df_active = pd.DataFrame(updated_trades)
            st.dataframe(df_active.style.applymap(
                lambda v: "background-color: lightgreen" if "Win" in v else "background-color: lightcoral" if "Loss" in v else "",
                subset=["status"]
            ))
        else:
            st.info("🎯 No running trades. All done!")

    else:
        st.info("🔍 No active trades yet.")

    # === Trade History ===
    st.header("📜 Trade History")

    if st.session_state.trade_history:
        df_history = pd.DataFrame(st.session_state.trade_history)
        st.dataframe(df_history)
    else:
        st.info("No completed trades yet.")

else:
    st.warning("⚠️ Please input your Deriv API Token to connect!")

