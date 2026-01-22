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
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
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

    // إعدادات الفحص (للخلف وللأمام)
    const BACKWARD_CHECK = 800; // عدد الطلبات للفحص خلف الرقم الحالي
    const FORWARD_CHECK = 800;  // عدد الطلبات للفحص أمام الرقم الحالي
    const BATCH_SIZE = 100;     // حجم الدفعة في الطلب الواحد

    try {
        await sendTelegram("🛡️ <b>المحارب عبد الباقي يبدأ عملية المسح الشامل (خلفي وأمامي)...</b>");

        // إيقاظ السيرفرات
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

        // جلب آخر الآيديهات من قاعدتك
        const statsRes = await axios.get(`${BRIDGE_URL}?action=get_stats`, config);
        const rows = statsRes.data;

        if (!Array.isArray(rows) || rows.length === 0) {
            await sendTelegram("✅ <b>انتهى الفحص.. لا يوجد مزودات مسجلة.</b>");
            return;
        }

        await sendTelegram(`📊 <b>عدد المزودات المكتشفة: ${rows.length}</b>`);

        for (const row of rows) {
            const provKey = row.api_provider;
            if (!providers_map[provKey]) continue;

            const lastId = parseInt(row.last_id) || 0;
            const provInfo = providers_map[provKey];

            // 1. حساب نقطة البداية والنهاية
            // نبدأ من (آخر رقم - 100) وننتهي عند (آخر رقم + 800)
            let startScanId = lastId - BACKWARD_CHECK;
            if (startScanId < 1) startScanId = 1; // ضمان عدم النزول تحت الصفر
            
            let endScanId = lastId + FORWARD_CHECK;
            
            const totalIdsToCheck = endScanId - startScanId + 1;

            await sendTelegram(
                `🔍 <b>فحص مزود: ${provInfo.name}</b>\n` +
                `🎯 آخر رقم مسجل: <code>${lastId}</code>\n` +
                `🔙 فحص خلفي من: <code>${startScanId}</code>\n` +
                `🔜 فحص أمامي إلى: <code>${endScanId}</code>`
            );

            await sendTelegram(`⏳ <b>انتظار 10 ثوانٍ قبل الهجوم...</b>`);
            await delay(10000);

            let scannedThis = 0;

            // حلقة الفحص من البداية (الخلف) إلى النهاية (الأمام)
            for (let offset = 0; offset < totalIdsToCheck; offset += BATCH_SIZE) {
                const currentBatchStart = startScanId + offset;
                const currentBatchEnd = Math.min(currentBatchStart + BATCH_SIZE - 1, endScanId);
                
                // إنشاء مصفوفة الآيديهات لهذه الدفعة
                const ids = Array.from({length: currentBatchEnd - currentBatchStart + 1}, (_, i) => currentBatchStart + i);

                if (ids.length === 0) break;

                const payload = { orders: ids.join(',') };

                try {
                    // 1. الفحص في البروكسي (المزود)
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

                        // الشرط: هل الطلب موجود في المزود وحالته صالحة؟
                        if (order.status && !/error|not found|invalid|incorrect/i.test(order.status)) {
                            
                            // 2. إذا وجدناه في المزود، نتحقق من قاعدتنا (Local DB)
                            try {
                                const check = await axios.get(
                                    `${BRIDGE_URL}?action=check_order&order_id=${id}`,
                                    config
                                );

                                if (check.data?.exists === true) {
                                    // موجود في المزود وموجود عندنا = سليم
                                    // (يمكنك تفعيل هذا السطر إذا أردت رؤية الطلبات السليمة، لكن الأفضل إخفاؤه لعدم الإزعاج)
                                    // await sendTelegram(`✅ سليم: ${id}`);
                                } else {
                                    // موجود في المزود وغير موجود عندنا = احتيال
                                    fraudDetected = true;
                                    await sendTelegram(
                                        `🚨 <b>كشف احتيال في ${provInfo.name}!</b>\n` +
                                        `🆔 رقم الطلب: <code>${id}</code>\n` +
                                        `🔎 الحالة في المزود: ${order.status}\n` +
                                        `❌ <b>غير موجود في قاعدة البيانات! يجب إلغاؤه.</b>`
                                    );
                                }
                            } catch (dbErr) {
                                console.log(dbErr);
                                await sendTelegram(
                                    `⚠️ <b>خطأ اتصال بالقاعدة للرقم <code>${id}</code></b>`
                                );
                            }
                        } else {
                            // إذا لم يجد شيئاً في المزود، فهذا طبيعي (خاصة في الفحص الأمامي)
                        }
                    }

                    // تقرير مرحلي كل 200 طلب
                    if (scannedThis % 200 === 0) {
                        await sendTelegram(
                            `📈 <b>${provInfo.name}</b>: تم مسح ${scannedThis} طلب (وصلنا لـ ${currentBatchEnd})...`
                        );
                    }

                } catch (err) {
                    await sendTelegram(
                        `⚠️ <b>تجاوز دفعة ${currentBatchStart}–${currentBatchEnd} بسبب خطأ: ${err.message}</b>`
                    );
                }

                if (currentBatchEnd < endScanId) await delay(1000);
            }

            await sendTelegram(
                `✅ <b>انتهى فحص ${provInfo.name}</b>\nإجمالي المفحوص: ${scannedThis}`
            );
        }

        const final = fraudDetected
            ? "🔴 <b>انتهى الفحص – تم رصد عمليات احتيال (طلبات وهمية)!</b>"
            : "✅ <b>انتهى الفحص – الوضع آمن ونظيف.</b>";

        await sendTelegram(`${final}\nإجمالي العمليات المفحوصة: ${totalScanned}`);

    } catch (e) {
        await sendTelegram(`❌ <b>خطأ كارثي في النظام: ${e.message}</b>`);
    }
}

startScan();
