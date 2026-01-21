const axios = require('axios');

// ضع رابط ملف الجسر الذي رفعته على استضافتك هنا
const BRIDGE_URL = "https://yourdomain.com/api_bridge.php"; // <--- غير هذا الرابط برابط موقعك الحقيقي

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
    } catch (e) { console.error("Telegram Error"); }
}

async function startScan() {
    try {
        console.log("جاري جلب الإحصائيات عبر الجسر...");
        const statsRes = await axios.get(`${BRIDGE_URL}?action=get_stats`);
        const rows = statsRes.data;

        for (const row of rows) {
            const provKey = row.api_provider;
            if (!providers_map[provKey]) continue;

            const lastId = parseInt(row.last_id);
            const provInfo = providers_map[provKey];
            console.log(`فحص ${provInfo.name} من بعد ID: ${lastId}`);

            const nextIds = Array.from({length: 50}, (_, i) => lastId + 1 + i);
            
            try {
                const response = await axios.post(`${provInfo.url}/orders`, { orders: nextIds.join(',') });
                const results = response.data;

                for (const id of nextIds) {
                    const orderData = results[id] || results[id.toString()];
                    if (orderData && orderData.status && !/error|not found/i.test(orderData.status)) {
                        
                        // التحقق عبر الجسر إذا كان الطلب عندك
                        const checkRes = await axios.get(`${BRIDGE_URL}?action=check_order&order_id=${id}`);
                        if (!checkRes.data.exists) {
                            const msg = `🚨 <b>احتيال مكتشف!</b>\n\n` +
                                        `📌 المزود: ${provInfo.name}\n` +
                                        `🆔 رقم الطلب: ${id}\n` +
                                        `📊 الحالة: ${orderData.status}`;
                            await sendTelegram(msg);
                            console.log(`! تم اكتشاف احتيال: ${id}`);
                        }
                    }
                }
            } catch (err) { console.error(`Error with ${provInfo.name}`); }
        }
    } catch (err) { console.error("Bridge Connection Error:", err.message); }
}

startScan();
