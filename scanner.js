const axios = require('axios');

const BRIDGE_URL = "http://gaaaagaaa.onlinewebshop.net/api_bridge.php";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const providers_map = {
    'peakerr_prox': { name: 'Peakerr', url: 'https://peakerr-status-2.onrender.com' },
    'trendfly_prox': { name: 'Trendfly', url: 'https://trendfly-status.onrender.com' },
    'More_prox': { name: 'More', url: 'https://MORE-PROXY-URL-HERE.onrender.com' }, // ← غيّر الرابط الصحيح
    'smm_prox': { name: 'SMMact', url: 'https://smm-status.onrender.com' }
};

async function sendTelegram(message) {
    if (!TELEGRAM_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
        // تأخير صغير جدًا بين الرسائل لتجنب rate-limit
        await new Promise(r => setTimeout(r, 600));
    } catch (e) {
        console.error("Telegram send error:", e.message);
    }
}

async function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function startScan() {
    let fraudDetected = false;
    let totalScanned = 0;

    try {
        await sendTelegram("🛡️ <b>المحارب عبد الباقي يقوم بتفقد أمان الموقع...</b>");

        // إيقاظ الـ proxies (اختياري لكن مفيد)
        const wakeHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
        await Promise.all(
            Object.values(providers_map).map(p =>
                axios.get(p.url, { headers: wakeHeaders, timeout: 10000 }).catch(() => {})
            )
        );
        await delay(2000);

        const config = {
            timeout: 20000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        };

        // 1. جلب عدد المزودين + آخر أرقام
        const statsRes = await axios.get(`${BRIDGE_URL}?action=get_stats`, config);
        const rows = statsRes.data;

        if (!Array.isArray(rows) || rows.length === 0) {
            await sendTelegram("✅ <b>انتهى الفحص.. لا يوجد مزودات.</b>");
            return;
        }

        await sendTelegram(`📊 <b>عدد المزودات المكتشفة: ${rows.length}</b>`);

        // 2. فحص تسلسلي لكل مزود
        for (const row of rows) {
            const provKey = row.api_provider;
            if (!providers_map[provKey]) continue;

            const lastId = parseInt(row.last_id) || 0;
            const provInfo = providers_map[provKey];
            const TOTAL_TO_CHECK = 1000;
            const BATCH_SIZE = 100;

            await sendTelegram(
                `🔍 <b>بدء فحص مزود: ${provInfo.name}</b>\n` +
                `من الطلب <code>\( {lastId + 1}</code> إلى <code> \){lastId + TOTAL_TO_CHECK}</code>`
            );

            // 3. انتظار 30 ثانية فقط – بدون أي استدعاء إضافي
            await sendTelegram(`⏳ <b>انتظار 30 ثانية قبل البدء الفعلي...</b>`);
            await delay(30000);

            let scannedThis = 0;

            for (let offset = 0; offset < TOTAL_TO_CHECK; offset += BATCH_SIZE) {
                const start = lastId + 1 + offset;
                const end = Math.min(start + BATCH_SIZE - 1, lastId + TOTAL_TO_CHECK);
                const ids = Array.from({length: end - start + 1}, (_, i) => start + i);

                if (ids.length === 0) break;

                const payload = { orders: ids.join(',') };

                try {
                    const resp = await axios.post(`${provInfo.url}/orders`, payload, {
                        timeout: 30000,
                        headers: {
                            'Content-Type': 'application/json',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                        }
                    });

                    const data = resp.data || {};

                    for (const id of ids) {
                        scannedThis++;
                        totalScanned++;

                        const order = data[id] || data[id.toString()] || {};

                        if (order.status && !/error|not found|invalid/i.test(order.status)) {
                            // وجد طلب موجود في الـ proxy فوق آخر رقم مسجل
                            await sendTelegram(
                                `⚠️ <b>طلب مشكوك فيه رقم <code>${id}</code> في ${provInfo.name}</b>`
                            );

                            // تحقق من الداتابيز
                            try {
                                const check = await axios.get(
                                    `\( {BRIDGE_URL}?action=check_order&order_id= \){id}`,
                                    config
                                );

                                if (check.data?.exists === true) {
                                    await sendTelegram(
                                        `✅ <b>تم التحقق من الرقم <code>${id}</code> بأمان، وجدته في قاعدة البيانات</b>`
                                    );
                                } else {
                                    fraudDetected = true;
                                    await sendTelegram(
                                        `🚨 <b>الطلب احتيالي رقم <code>${id}</code> في ${provInfo.name}!</b>`
                                    );
                                }
                            } catch (dbErr) {
                                await sendTelegram(
                                    `⚠️ <b>خطأ في التحقق من الداتابيز للرقم <code>${id}</code></b>`
                                );
                            }
                        }
                    }

                    // تقدم كل 200
                    if (scannedThis % 200 === 0 || scannedThis === TOTAL_TO_CHECK) {
                        await sendTelegram(
                            `📈 <b>${provInfo.name}</b>: مفحوص ${scannedThis} طلب حتى الآن...`
                        );
                    }

                } catch (err) {
                    await sendTelegram(
                        `⚠️ <b>خطأ في دفعة \( {start}– \){end} لـ ${provInfo.name}: ${err.message}</b>`
                    );
                }

                if (end < lastId + TOTAL_TO_CHECK) await delay(1000);
            }

            await sendTelegram(
                `✅ <b>انتهى فحص ${provInfo.name}</b>\nمفحوص: ${scannedThis} طلب`
            );
        }

        const final = fraudDetected
            ? "🔴 <b>انتهى الفحص – تم اكتشاف احتيال!</b>"
            : "✅ <b>انتهى الفحص – كل شيء نظيف</b>";

        await sendTelegram(`${final}\nإجمالي المفحوص: ${totalScanned}`);

    } catch (e) {
        await sendTelegram(`❌ <b>خطأ عام: ${e.message}</b>`);
    }
}

startScan();
