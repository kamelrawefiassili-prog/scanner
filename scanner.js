const axios = require('axios');

const BRIDGE_URL = "http://gaaaagaaa.onlinewebshop.net/api_bridge.php";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const providers_map = {
    'peakerr_prox': { name: 'Peakerr', url: 'https://peakerr-status-2.onrender.com' },
    'trendfly_prox': { name: 'Trendfly', url: 'https://trendfly-status.onrender.com' },
    'More_prox': { name: 'More', url: 'https://smm-status.onrender.com' }
};

async function sendTelegram(message) {
    if (!TELEGRAM_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML'
        });
    } catch (e) { console.error("Telegram Error:", e.message); }
}

async function startScan() {
    let fraudDetected = false;
    try {
        await sendTelegram("المحارب عبد الباقي يقوم بتفقد أمان الموقع...");

        console.log("إيقاظ الـ proxies...");
        await Promise.all(
            Object.values(providers_map).map(p => axios.get(p.url).catch(() => {}))
        );

        const config = {
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0...' }
        };

        const statsRes = await axios.get(`${BRIDGE_URL}?action=get_stats`, config);
        const rows = statsRes.data;

        if (!Array.isArray(rows) || rows.length === 0) {
            await sendTelegram("انتهى الفحص.. لا يوجد مزودات أو بيانات.");
            return;
        }

        await Promise.all(rows.map(async (row) => {
            const provKey = row.api_provider;
            if (!providers_map[provKey]) return;

            const lastId = parseInt(row.last_id) || 0;
            const provInfo = providers_map[provKey];
            const CHECK_COUNT = 200; // قللناه
            const nextIds = Array.from({length: CHECK_COUNT}, (_, i) => lastId + 1 + i);

            try {
                const response = await axios.post(`${provInfo.url}/orders`, { 
                    orders: nextIds.join(',') 
                }, { timeout: 30000 });

                const results = response.data || {};

                for (const id of nextIds) {
                    const orderData = results[id] || results[id.toString()];
                    if (orderData?.status && !/error|not found|pending/i.test(orderData.status)) {
                        try {
                            const checkRes = await axios.get(
                                `\( {BRIDGE_URL}?action=check_order&order_id= \){id}`, 
                                { ...config, timeout: 10000 }
                            );
                            if (checkRes.data?.exists === false) {
                                fraudDetected = true;
                                const msg = `احتيال مكتشف!\n\nالمزود: \( {provInfo.name}\nالطلب: <code> \){id}</code>\nالوقت: ${new Date().toLocaleString('ar-TN')}`;
                                await sendTelegram(msg);
                            }
                        } catch (e) {}
                    }
                }
            } catch (err) {
                console.error(`خطأ في ${provInfo.name}:`, err.message);
            }
        }));

        if (!fraudDetected) {
            await sendTelegram("انتهى المحارب عبد الباقي من الفحص.. كل شيء نظيف لا تقلق، كل شيء على ما يرام.");
        }

    } catch (err) {
        await sendTelegram(`خطأ في السكانر: ${err.message}`);
        console.error(err);
    }
}

startScan();
