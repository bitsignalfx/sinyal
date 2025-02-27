const WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');
const ti = require('technicalindicators');

// API Keys (Ganti dengan API Anda)
const FINNHUB_API_KEY = 'cutfir9r01qrsirmiddgcutfir9r01qrsirmide0';
const TELEGRAM_BOT_TOKEN = '7916910097:AAE1mGKREJUHspa2T6T7Nr9XWy9-1omCFvk';
const TELEGRAM_CHAT_ID = '-1002491325716';

// Inisialisasi WebSocket & Bot
const ws = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_API_KEY}`);
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Data harga dan sinyal aktif
let priceData = { BTCUSD: [], XAUUSD: [] };
let activeSignal = { BTCUSD: null, XAUUSD: null };

ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'subscribe', symbol: 'BINANCE:BTCUSDT' }));
    ws.send(JSON.stringify({ type: 'subscribe', symbol: 'OANDA:XAU_USD' }));
});

ws.on('message', (data) => {
    const response = JSON.parse(data);
    if (response.data) {
        response.data.forEach(tick => {
            const symbol = tick.s.includes('BTCUSDT') ? 'BTCUSD' : 'XAUUSD';
            let volume = tick.v || 0;

            priceData[symbol].push({ close: tick.p, high: tick.p + 2, low: tick.p - 2, volume });
            if (priceData[symbol].length > 200) priceData[symbol].shift();

            if (!activeSignal[symbol]) {
                checkForSignal(symbol);
            } else {
                monitorSignal(symbol);
            }
        });
    }
});

async function checkForSignal(symbol) {
    if (priceData[symbol].length < 50) return;

    let closePrices = priceData[symbol].map(p => p.close);
    let highPrices = priceData[symbol].map(p => p.high);
    let lowPrices = priceData[symbol].map(p => p.low);
    let volumes = priceData[symbol].map(p => p.volume);

    let indicators = calculateIndicators(closePrices, highPrices, lowPrices, volumes);
    let atr = indicators.atr[indicators.atr.length - 1];

    if (!atr) return;

    let signal = generateSignal(symbol, indicators);
    if (signal) {
        let tpMultiplier = 100.5;
        let slMultiplier = 200.5;

        let tpLimit = symbol === "BTCUSD" ? 200 : 2;
        let slLimit = symbol === "BTCUSD" ? 500 : 5;

        let tp = signal.entry + (signal.direction === "BUY" ? Math.min(atr * tpMultiplier, tpLimit) : -Math.min(atr * tpMultiplier, tpLimit));
        let sl = signal.entry + (signal.direction === "BUY" ? -Math.min(atr * slMultiplier, slLimit) : Math.min(atr * slMultiplier, slLimit));

        activeSignal[symbol] = { direction: signal.direction, entry: signal.entry, tp, sl };
        sendSignalToTelegram(symbol, signal.direction, signal.entry, tp, sl);
    }
}

function monitorSignal(symbol) {
    if (!activeSignal[symbol]) return;

    let currentPrice = priceData[symbol][priceData[symbol].length - 1].close;
    let { direction, entry, tp, sl } = activeSignal[symbol];

    if ((direction === "BUY" && currentPrice >= tp) || (direction === "SELL" && currentPrice <= tp)) {
        bot.sendMessage(TELEGRAM_CHAT_ID, `🎯 **${symbol} TP Tercapai!**\n📈 Harga: ${currentPrice.toFixed(2)}`);
        activeSignal[symbol] = null;
    } else if ((direction === "BUY" && currentPrice <= sl) || (direction === "SELL" && currentPrice >= sl)) {
        bot.sendMessage(TELEGRAM_CHAT_ID, `⚠️ **${symbol} SL Tercapai!**\n📉 Harga: ${currentPrice.toFixed(2)}`);
        activeSignal[symbol] = null;
    }
}

function calculateIndicators(close, high, low, volume) {
    return {
        bb: ti.BollingerBands.calculate({ period: 20, values: close, stdDev: 2 }),
        macd: ti.MACD.calculate({ values: close, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 }),
        rsi: ti.RSI.calculate({ values: close, period: 14 }),
        stochRSI: ti.StochasticRSI.calculate({ values: close, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3 }),
        ema21: ti.EMA.calculate({ values: close, period: 21 }),
        ema50: ti.EMA.calculate({ values: close, period: 50 }),
        ema200: ti.EMA.calculate({ values: close, period: 200 }),
        adx: ti.ADX.calculate({ high, low, close, period: 14 }),
        atr: ti.ATR.calculate({ high, low, close, period: 14 }),
        obv: ti.OBV.calculate({ close, volume }),
        kc: ti.KeltnerChannels.calculate({ high, low, close, period: 20, multiplier: 1.5 }),
        donchian: calculateDonchian(high, low, 20)  // Menggunakan fungsi manual
    };
}

function calculateDonchian(high, low, period = 20) {
    if (high.length < period || low.length < period) return null;
    let upper = Math.max(...high.slice(-period));
    let lower = Math.min(...low.slice(-period));
    let middle = (upper + lower) / 2;
    return { upper, lower, middle };
}

function generateSignal(symbol, indicators) {
    let lastBB = indicators.bb[indicators.bb.length - 1];
    let lastMACD = indicators.macd[indicators.macd.length - 1];
    let lastRSI = indicators.rsi[indicators.rsi.length - 1];
    let lastStochRSI = indicators.stochRSI[indicators.stochRSI.length - 1];
    let lastADX = indicators.adx[indicators.adx.length - 1];
    let emaFast = indicators.ema21[indicators.ema21.length - 1];
    let emaSlow = indicators.ema50[indicators.ema50.length - 1];
    let ema200 = indicators.ema200[indicators.ema200.length - 1];
    let obv = indicators.obv[indicators.obv.length - 1];

    let price = priceData[symbol][priceData[symbol].length - 1].close;

    if (lastMACD.MACD > lastMACD.signal && lastRSI > 50 &&
        lastStochRSI.k > 20 && emaFast > emaSlow &&
        lastADX.adx > 25 && obv > obv * 0.98 &&
        price > lastBB.upper && price > ema200) {
        return { direction: "BUY", entry: price };
    } else if (lastMACD.MACD < lastMACD.signal && lastRSI < 50 &&
        lastStochRSI.k < 80 && emaFast < emaSlow &&
        lastADX.adx > 25 && obv < obv * 1.02 &&
        price < lastBB.lower && price < ema200) {
        return { direction: "SELL", entry: price };
    }
    return null;
}

function sendSignalToTelegram(symbol, direction, entry, tp, sl) {
    let message = `📢 **Sinyal Baru**\n\n` +
                  `📌 **${symbol}**\n` +
                  `📈 **Signal**: ${direction}\n` +
                  `💰 **Entry**: ${entry.toFixed(2)}\n` +
                  `🎯 **TP**: ${tp.toFixed(2)}\n` +
                  `🛑 **SL**: ${sl.toFixed(2)}\n`;

    bot.sendMessage(TELEGRAM_CHAT_ID, message);
}
