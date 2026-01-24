const axios = require('axios');

const BRIDGE_URL = "http://gaaaagaaa.onlinewebshop.net/api_bridge.php";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const providers_map = {
    'peakerr_prox': { name: 'Peakerr', url: 'https://peakerr-status-2.onrender.com' },
    'trendfly_prox': { name: 'Trendfly', url: 'https://trendfly-status.onrender.com' },
    'More_prox': { name: 'More', url: 'https://smm-status.onrender.com' }
};

// إعدادات المتصفح للطلبات
const config = {
    timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
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

// دالة إلغاء الطلب التلقائية
async function autoCancelFraud(provUrl, orderId, provName) {
    try {
        const resp = await axios.post(`${provUrl}/cancel`, { orders: orderId.toString() }, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
        });
        
        // التحقق من نجاح الإلغاء (بناءً على رد البروكسي المعتاد)
        if (resp.data && (resp.data.cancel === 1 || (Array.isArray(resp.data) && resp.data[0].cancel === 1))) {
            return `✅ تم إلغاء الطلب رقم <code>${orderId}</code> تلقائياً من ${provName}.`;
        } else {
            return `⚠️ استجاب المزود ولكن فشل الإلغاء للطلب <code>${orderId}</code>.`;
        }
    } catch (err) {
        return `❌ خطأ تقني أثناء محاولة إلغاء الطلب <code>${orderId}</code>: ${err.message}`;
    }
}

async function startScan() {
    const BACKWARD_CHECK = 700;
    const FORWARD_CHECK = 1000;
    const BATCH_SIZE = 100;

    let stats = {
        totalScanned: 0,
        fraudDetected: 0,
        status: { canceled: 0, active: 0, completed: 0 },
        lostMoney: 0.0
    };

    try {
        await sendTelegram("🛡️ <b>المحارب عبد الباقي: بدء الفحص والصد التلقائي...</b>");

        // إيقاظ السيرفرات (Render)
        Object.values(providers_map).map(p => axios.get(p.url, { timeout: 10000 }).catch(() => {}));
        await delay(3000);

        const statsRes = await axios.get(`${BRIDGE_URL}?action=get_stats`, config);
        const rows = statsRes.data;

        if (!Array.isArray(rows) || rows.length === 0) {
            await sendTelegram("✅ <b>لا يوجد مزودات للفحص حالياً.</b>");
            return;
        }

        for (const row of rows) {
            const provKey = row.api_provider;
            if (!providers_map[provKey]) continue;

            const provInfo = providers_map[provKey];
            const lastId = parseInt(row.last_id) || 0;
            let startScanId = Math.max(1, lastId - BACKWARD_CHECK);
            let endScanId = lastId + FORWARD_CHECK;
            const totalIdsToCheck = endScanId - startScanId + 1;

            await sendTelegram(`🔍 <b>${provInfo.name}</b>: جاري فحص <code>${totalIdsToCheck}</code> طلب...`);

            for (let offset = 0; offset < totalIdsToCheck; offset += BATCH_SIZE) {
                const currentBatchStart = startScanId + offset;
                const currentBatchEnd = Math.min(currentBatchStart + BATCH_SIZE - 1, endScanId);
                const ids = Array.from({length: currentBatchEnd - currentBatchStart + 1}, (_, i) => currentBatchStart + i);

                try {
                    // 1. جلب البيانات من المزود (البروكسي)
                    const resp = await axios.post(`${provInfo.url}/orders`, { orders: ids.join(',') }, {
                        timeout: 35000,
                        headers: { 'Content-Type': 'application/json' }
                    });

                    const data = resp.data || {};
                    
                    // تحضير قائمة IDs التي وُجدت فعلياً عند المزود وليست خطأ
                    const existingAtProvider = ids.filter(id => {
                        const s = (data[id]?.status || "").toLowerCase();
                        return s && !/error|not found|invalid|incorrect/i.test(s);
                    });

                    if (existingAtProvider.length > 0) {
                        // 2. الفحص الجماعي (Bulk Check) - يرسل كل الـ IDs في طلب واحد للسيرفر
                        // ملاحظة: تأكد أن api_bridge.php يدعم action=check_bulk
                        const bulkCheck = await axios.post(`${BRIDGE_URL}?action=check_bulk`, { 
                            ids: existingAtProvider 
                        }, config);
                        
                        const myExistingIds = bulkCheck.data.existing_ids || [];

                        for (const id of existingAtProvider) {
                            stats.totalScanned++;

                            if (!myExistingIds.includes(id)) {
                                stats.fraudDetected++;
                                const order = data[id] || {};
                                const orderStatus = (order.status || "").toLowerCase();
                                const charge = parseFloat(order.charge || 0);

                                if (orderStatus.includes('cancel')) {
                                    stats.status.canceled++;
                                    await sendTelegram(`🛡️ <b>محاولة احتيال مصدودة</b> في ${provInfo.name}\nطلب: <code>${id}</code> (ملغي مسبقاً)`);

                                } else if (['completed', 'partial'].includes(orderStatus)) {
                                    stats.status.completed++;
                                    stats.lostMoney += charge;
                                    await sendTelegram(`💔 <b>خسارة مالية!</b> في ${provInfo.name}\nطلب: <code>${id}</code>\nالحالة: ${order.status}\nالتكلفة: $${charge}`);

                                } else {
                                    // 🔥 طلب نشط (Pending/Processing) -> إلغاء فوري
                                    stats.status.active++;
                                    await sendTelegram(`🚨 <b>كشف احتيال نشط!</b> في ${provInfo.name}\nطلب: <code>${id}</code>\nالحالة: <b>${order.status}</b>\n⚡ جاري محاولة الإلغاء التلقائي...`);
                                    
                                    const cancelMsg = await autoCancelFraud(provInfo.url, id, provInfo.name);
                                    await sendTelegram(cancelMsg);
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Batch Error: ${err.message}`);
                }
                await delay(1000); // تنفس للسيرفر
            }
        }

        // التقرير النهائي
        let finalReport = stats.fraudDetected === 0 
            ? "✅ <b>انتهى الفحص - النظام سليم تماماً.</b>"
            : `📊 <b>التقرير النهائي للعملية:</b>\n` +
              `🔴 احتيال مكتشف: ${stats.fraudDetected}\n` +
              `🛡️ تم صدها (ملغية): ${stats.status.canceled}\n` +
              `🔥 نشطة (تم التعامل معها): ${stats.status.active}\n` +
              `💔 مكتملة (خسائر): ${stats.status.completed}\n` +
              `💸 إجمالي الأموال المهدرة: $${stats.lostMoney.toFixed(3)}\n` +
              `🔎 إجمالي الطلبات المفحوصة: ${stats.totalScanned}`;

        await sendTelegram(finalReport);

    } catch (e) {
        await sendTelegram(`❌ <b>خطأ فادح في السكربت: ${e.message}</b>`);
    }
}

startScan();
