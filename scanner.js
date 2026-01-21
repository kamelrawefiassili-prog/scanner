const axios = require('axios');

const BRIDGE_URL = "http://gaaaagaaa.onlinewebshop.net/api_bridge.php";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const providers_map = {
    'peakerr_prox': { name: 'Peakerr', url: 'https://peakerr-status-2.onrender.com' },
    'trendfly_prox': { name: 'Trendfly', url: 'https://trendfly-status.onrender.com' },
    'More_prox': { name: 'More', url: 'https://MORE-PROXY-URL-HERE.onrender.com' },  // غيّر بالرابط الصحيح لـ More!
    'smm_prox': { name: 'SMMact', url: 'https://smm-status.onrender.com' }
};

async function sendTelegram(message) {
    if (!TELEGRAM_TOKEN) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML'
        });
        await new Promise(resolve => setTimeout(resolve, 500)); // تأخير بسيط بين الرسائل
    } catch (e) { console.error("Telegram Error:", e.message); }
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getLatestIdForProvider(provKey) {
    const config = { timeout: 20000, headers: { 'User-Agent': 'Mozilla/5.0' } };
    try {
        const statsRes = await axios.get(`${BRIDGE_URL}?action=get_stats`, config);
        const rows = statsRes.data;
        const row = rows.find(r => r.api_provider === provKey);
        return row ? parseInt(row.last_id) || 0 : 0;
    } catch (e) {
        console.error("Error fetching latest ID:", e.message);
        return 0;
    }
}

async function startScan() {
    let fraudDetected = false;
    let totalScannedGlobal = 0;

    try {
        await sendTelegram("🛡️ <b>المحارب عبد الباقي يقوم بتفقد أمان الموقع...</b>");

        // إيقاظ الـ proxies
        const wakeHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
        await Promise.all(
            Object.values(providers_map).map(p =>
                axios.get(p.url, { headers: wakeHeaders, timeout: 15000 }).catch(() => {})
            )
        );
        await delay(3000);

        const config = {
            timeout: 20000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        };

        const statsRes = await axios.get(`${BRIDGE_URL}?action=get_stats`, config);
        const rows = statsRes.data;

        if (!Array.isArray(rows) || rows.length === 0) {
            await sendTelegram("✅ <b>انتهى الفحص.. لا يوجد مزودات.</b>");
            return;
        }

        await sendTelegram(`📊 <b>عدد المزودات: ${rows.length}</b>\n<i>جاري الفحص تسلسليًا الآن...</i>`);

        // فحص تسلسلي لكل مزود
        for (const row of rows) {
            const provKey = row.api_provider;
            if (!providers_map[provKey]) continue;

            let lastId = parseInt(row.last_id) || 0;
            const provInfo = providers_map[provKey];
            const TOTAL_CHECK = 1000;
            const BATCH_SIZE = 100;
            const DELAY_BETWEEN = 1000;
            const PROGRESS_EVERY = 200;

            await sendTelegram(`🔍 <b>بدء فحص مزود: ${provInfo.name}</b>\nمن الطلب ${lastId + 1} إلى ${lastId + TOTAL_CHECK} (مؤقت)`);

            await sendTelegram(`⏳ <b>انتظار 30 ثانية قبل بدء الفحص الفعلي لـ ${provInfo.name}...</b>`);
            await delay(30000);

            // تحديث lastId بعد الانتظار عشان يلحق أي طلبات جديدة
            const newLastId = await getLatestIdForProvider(provKey);
            if (newLastId > lastId) {
                await sendTelegram(`🆕 <b>تم اكتشاف طلبات جديدة أثناء الانتظار! تحديث النطاق إلى ${newLastId + 1} - ${newLastId + TOTAL_CHECK}</b>`);
                lastId = newLastId;
            } else {
                await sendTelegram(`✅ <b>لا طلبات جديدة، جاري البدء بالنطاق الأصلي...</b>`);
            }

            let scannedThisProvider = 0;

            for (let i = 0; i < TOTAL_CHECK; i += BATCH_SIZE) {
                const batchStart = lastId + 1 + i;
                const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, lastId + TOTAL_CHECK);
                const batchIds = Array.from({length: batchEnd - batchStart + 1}, (_, k) => batchStart + k);

                if (batchIds.length === 0) break;

                const payload = { orders: batchIds.join(',') };

                const postConfig = {
                    timeout: 35000,
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'application/json'
                    }
                };

                try {
                    const response = await axios.post(`${provInfo.url}/orders`, payload, postConfig);
                    const results = response.data || {};

                    for (const id of batchIds) {
                        scannedThisProvider++;
                        totalScannedGlobal++;
                        const idStr = id.toString();
                        const orderData = results[idStr] || results[id];

                        if (orderData?.status && !/error|not found|invalid|pending/i.test(orderData.status)) {
                            await sendTelegram(`⚠️ <b>لقد وجدت طلب مشكوك فيه رقم <code>${id}</code> في مزود ${provInfo.name}</b>`);

                            try {
                                const checkRes = await axios.get(`\( {BRIDGE_URL}?action=check_order&order_id= \){id}`, config);
                                if (checkRes.data?.exists === true) {
                                    await sendTelegram(`✅ <b>تم التحقق منه بنجاح رقم <code>${id}</code> (موجود في قاعدة البيانات)</b>`);
                                } else {
                                    fraudDetected = true;
                                    await sendTelegram(`🚨 <b>الطلب احتيالي رقم <code>${id}</code> في مزود ${provInfo.name}!</b>`);
                                }
                            } catch (e) {
                                await sendTelegram(`⚠️ <b>خطأ في التحقق من DB لرقم <code>${id}</code></b>`);
                            }
                        }
                    }

                    if (scannedThisProvider % PROGRESS_EVERY === 0 || batchEnd === lastId + TOTAL_CHECK) {
                        await sendTelegram(`📈 <b>${provInfo.name}</b>: مفحوص ${scannedThisProvider} طلب حتى الآن...`);
                    }

                } catch (err) {
                    await sendTelegram(`⚠️ <b>خطأ في ${provInfo.name} أثناء دفعة \( {batchStart}- \){batchEnd}:</b> ${err.message || 'غير معروف'}`);
                    console.error(`[${provInfo.name}] خطأ:`, err);
                }

                if (batchEnd < lastId + TOTAL_CHECK) await delay(DELAY_BETWEEN);
            }

            await sendTelegram(`✅ <b>انتهى فحص ${provInfo.name}</b>\nمفحوص: ${scannedThisProvider} طلب`);
        }

        const finalMsg = fraudDetected 
            ? "🔴 <b>انتهى الفحص: تم اكتشاف احتيال!</b>" 
            : "✅ <b>انتهى المحارب عبد الباقي من الفحص.. كل شيء نظيف!</b>";
        
        await sendTelegram(`${finalMsg}\n📊 <b>إجمالي الطلبات المفحوصة: ${totalScannedGlobal}</b>`);

    } catch (err) {
        await sendTelegram(`❌ <b>خطأ كبير في السكانر:</b> ${err.message}`);
        console.error("Critical Error:", err);
    }
}

startScan();
