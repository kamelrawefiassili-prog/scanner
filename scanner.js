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

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function startScan() {
    let fraudDetected = false;
    try {
        await sendTelegram("🛡️ <b>المحارب عبد الباقي يقوم بتفقد أمان الموقع...</b>");

        console.log("إيقاظ الـ proxies أولاً...");
        await Promise.all(
            Object.values(providers_map).map(p => 
                axios.get(p.url).catch(() => console.log(`إيقاظ ${p.name}...`))
            )
        );
        await delay(2000); // تأخير إضافي بعد الإيقاظ

        const config = {
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        };

        const statsRes = await axios.get(`${BRIDGE_URL}?action=get_stats`, config);
        const rows = statsRes.data;

        if (!Array.isArray(rows) || rows.length === 0) {
            await sendTelegram("✅ <b>انتهى الفحص.. لا يوجد مزودات أو بيانات للفحص.</b>");
            return;
        }

        await sendTelegram(`📊 <b>عدد المزودات المكتشفة: ${rows.length}</b>`);

        // معالجة كل المزودات بالتوازي للسرعة
        await Promise.all(rows.map(async (row) => {
            const provKey = row.api_provider;
            if (!providers_map[provKey]) return;

            const lastId = parseInt(row.last_id) || 0;
            const provInfo = providers_map[provKey];
            const TOTAL_CHECK = 800;      // غيّر هنا للعدد اللي تحبه (1000، 2000...)
            const BATCH_SIZE = 100;       // حجم الدفعة (لا تزود عن 100 عشان الأمان)
            const DELAY_BETWEEN_BATCHES = 800; // مللي ثانية بين كل دفعة

            console.log(`[${provInfo.name}] بدء الفحص من ${lastId + 1} إلى ${lastId + TOTAL_CHECK}`);

            let scannedThisProvider = 0;

            for (let i = 0; i < TOTAL_CHECK; i += BATCH_SIZE) {
                const batchStart = lastId + 1 + i;
                const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, lastId + TOTAL_CHECK);
                const batchIds = Array.from({length: batchEnd - batchStart + 1}, (_, k) => batchStart + k);

                if (batchIds.length === 0) break;

                const isBulk = batchIds.length > 1;
                const endpoint = isBulk ? '/orders' : '/status';
                const payload = isBulk ? { orders: batchIds.join(',') } : { order: batchIds[0] };

                try {
                    console.log(`[${provInfo.name}] إرسال دفعة: ${batchIds[0]} إلى \( {batchIds[batchIds.length-1]} ( \){batchIds.length} طلب)`);

                    const response = await axios.post(`\( {provInfo.url} \){endpoint}`, payload, {
                        timeout: 30000
                    });

                    const results = response.data || {};

                    for (const id of batchIds) {
                        scannedThisProvider++;
                        const idStr = id.toString();
                        const orderData = isBulk ? (results[idStr] || results[id]) : results;

                        if (orderData && orderData.status && !/error|not found|invalid|pending/i.test(orderData.status)) {
                            try {
                                const checkRes = await axios.get(
                                    `\( {BRIDGE_URL}?action=check_order&order_id= \){id}`,
                                    { ...config, timeout: 10000 }
                                );

                                if (checkRes.data?.exists === false) {
                                    fraudDetected = true;
                                    const msg = `🚨 <b>احتيال مكتشف!</b>\n\n📌 المزود: \( {provInfo.name}\n🆔 الطلب: <code> \){id}</code>\n⏰ ${new Date().toLocaleString('ar-TN')}`;
                                    await sendTelegram(msg);
                                    console.log(`احتيال مكتشف: ${provInfo.name} - ${id}`);
                                }
                            } catch (e) {
                                console.error(`خطأ في التحقق من DB لـ ${id}:`, e.message);
                            }
                        }
                    }
                } catch (err) {
                    console.error(`[${provInfo.name}] خطأ في الدفعة \( {batchIds[0]}- \){batchIds[batchIds.length-1]}:`, err.message);
                    await sendTelegram(`⚠️ خطأ في فحص مزود ${provInfo.name}: ${err.message}`);
                }

                // تأخير بين الدفعات فقط (مش في آخر دفعة)
                if (batchEnd < lastId + TOTAL_CHECK) {
                    await delay(DELAY_BETWEEN_BATCHES);
                }
            }

            console.log(`[${provInfo.name}] انتهى الفحص — تم فحص ${scannedThisProvider} طلب`);
        }));

        if (!fraudDetected) {
            await sendTelegram("✅ <b>انتهى المحارب عبد الباقي من الفحص.. كل شيء نظيف لا تقلق، كل شيء على ما يرام.</b>");
        } else {
            await sendTelegram("🔴 <b>تم اكتشاف احتيال وتم إرسال التنبيهات.</b>");
        }

    } catch (err) {
        await sendTelegram(`❌ <b>خطأ كبير في السكانر:</b> ${err.message}`);
        console.error("Critical Error:", err);
    }
}

startScan();
