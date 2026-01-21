const axios = require('axios');

// رابط الجسر الخاص بك
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
    } catch (e) { console.error("Telegram Error"); }
}

async function startScan() {
    try {
        console.log("جاري جلب الإحصائيات عبر الجسر...");
        
        const config = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Connection': 'keep-alive'
            }
        };

        const statsRes = await axios.get(`${BRIDGE_URL}?action=get_stats`, config);
        const rows = statsRes.data;

        if (!Array.isArray(rows)) {
            console.log("الرد المستلم ليس مصفوفة. محتوى الرد:");
            console.log(rows);
            return;
        }

        console.log(`تم جلب بيانات ${rows.length} مزودين بنجاح.`);

        for (const row of rows) {
            const provKey = row.api_provider;
            if (!providers_map[provKey]) continue;

            const lastId = parseInt(row.last_id);
            const provInfo = providers_map[provKey];
            console.log(`بدء فحص ${provInfo.name} من ID: ${lastId + 1}`);

            // سنفحص 20 طلب في كل دورة لتجنب الحظر
            const nextIds = Array.from({length: 20}, (_, i) => lastId + 1 + i);
            
            try {
                const response = await axios.post(`${provInfo.url}/orders`, { orders: nextIds.join(',') });
                const results = response.data;

                for (const id of nextIds) {
                    const orderData = results[id] || results[id.toString()];
                    if (orderData && orderData.status && !/error|not found/i.test(orderData.status)) {
                        
                        // التحقق عبر الجسر
                        const checkRes = await axios.get(`${BRIDGE_URL}?action=check_order&order_id=${id}`, config);
                        if (checkRes.data && checkRes.data.exists === false) {
                            const msg = `🚨 <b>احتيال مكتشف!</b>\n\n` +
                                        `📌 المزود: ${provInfo.name}\n` +
                                        `🆔 رقم الطلب: <code>${id}</code>\n` +
                                        `📊 الحالة: ${orderData.status}`;
                            await sendTelegram(msg);
                            console.log(`! اكتشاف احتيال: ${id}`);
                        }
                    }
                }
            } catch (err) { console.error(`خطأ في فحص مزود ${provInfo.name}`); }
        }
    } catch (err) { 
        console.error("Bridge Connection Error:", err.message);
    }
}

startScan();
