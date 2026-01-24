const axios = require('axios');

const BRIDGE_URL = "http://gaaaagaaa.onlinewebshop.net/api_bridge.php";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const providers_map = {
    'peakerr_prox': { 
        name: 'Peakerr', 
        url: 'https://peakerr-status-2.onrender.com'  // الـ proxy نفسه يدعم /cancel
    },
    'trendfly_prox': { 
        name: 'Trendfly', 
        url: 'https://trendfly-status.onrender.com'
    },
    'More_prox': { 
        name: 'More', 
        url: 'https://smm-status.onrender.com'
    }
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
    const BACKWARD_CHECK = 700;
    const FORWARD_CHECK = 1000;
    const BATCH_SIZE = 100;

    let stats = {
        totalScanned: 0,
        fraudDetected: 0,
        status: {
            canceled: 0,
            active: 0,
            completed: 0
        },
        lostMoney: 0.0
    };

    try {
        await sendTelegram("🛡️ <b>المحارب عبد الباقي: بدء الفحص التحليلي المتقدم...</b>");
        await sendTelegram(`⚙️ <b>نطاق الفحص:</b> -\( {BACKWARD_CHECK} (خلفي) / + \){FORWARD_CHECK} (أمامي)`);

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

        const statsRes = await axios.get(`${BRIDGE_URL}?action=get_stats`, config);
        const rows = statsRes.data;

        if (!Array.isArray(rows) || rows.length === 0) {
            await sendTelegram("✅ <b>لا يوجد مزودات للفحص.</b>");
            return;
        }

        for (const row of rows) {
            const provKey = row.api_provider;
            if (!providers_map[provKey]) continue;

            const lastId = parseInt(row.last_id) || 0;
            const provInfo = providers_map[provKey];

            let startScanId = lastId - BACKWARD_CHECK;
            if (startScanId < 1) startScanId = 1;
            let endScanId = lastId + FORWARD_CHECK;

            await sendTelegram(
                `🔍 <b>\( {provInfo.name}</b>: جاري الفحص من <code> \){startScanId}</code> إلى <code>${endScanId}</code>`
            );

            await delay(5000);

            for (let offset = 0; offset < (endScanId - startScanId + 1); offset += BATCH_SIZE) {
                const currentBatchStart = startScanId + offset;
                const currentBatchEnd = Math.min(currentBatchStart + BATCH_SIZE - 1, endScanId);
                const ids = Array.from({length: currentBatchEnd - currentBatchStart + 1}, (_, i) => currentBatchStart + i);

                if (ids.length === 0) break;

                try {
                    const resp = await axios.post(`${provInfo.url}/orders`, { orders: ids.join(',') }, {
                        timeout: 30000,
                        headers: { 'Content-Type': 'application/json' }
                    });

                    const data = resp.data || {};

                    for (const id of ids) {
                        stats.totalScanned++;

                        const order = data[id] || data[id.toString()] || {};
                        const orderStatus = (order.status || "").toLowerCase();

                        if (orderStatus && !/error|not found|invalid|incorrect/i.test(orderStatus)) {
                            
                            try {
                                const check = await axios.get(
                                    `\( {BRIDGE_URL}?action=check_order&order_id= \){id}`,
                                    config
                                );

                                if (check.data?.exists !== true) {
                                    stats.fraudDetected++;
                                    const charge = parseFloat(order.charge || 0);

                                    if (orderStatus.includes('cancel')) {
                                        stats.status.canceled++;
                                        await sendTelegram(
                                            `🛡️ <b>كشف محاولة احتيال (تم صدها) في ${provInfo.name}</b>\n` +
                                            `رقم الطلب: <code>${id}</code>\n` +
                                            `الحالة: <b>Canceled</b> (تم الإلغاء بالفعل) ✅`
                                        );

                                    } else if (['completed', 'partial'].includes(orderStatus)) {
                                        stats.status.completed++;
                                        stats.lostMoney += charge;
                                        await sendTelegram(
                                            `💔 <b>للأسف! مر علينا طلب احتيالي في ${provInfo.name}</b>\n` +
                                            `رقم الطلب: <code>${id}</code>\n` +
                                            `الحالة: <b>${order.status}</b>\n` +
                                            `💰 التكلفة (خسارة): <b>\[ {charge}</b>`
                                        );

                                    } else {
                                        // احتيال نشط → محاولة إلغاء تلقائي عبر الـ proxy نفسه
                                        stats.status.active++;
                                        await sendTelegram(
                                            `🚨 <b>خطر! طلب احتيال لا يزال نشطاً في ${provInfo.name}</b>\n` +
                                            `رقم الطلب: <code>${id}</code>\n` +
                                            `الحالة: <b>${order.status}</b>\n` +
                                            `⚡ <b>جاري محاولة الإلغاء التلقائي...</b>`
                                        );

                                        // ==== الإلغاء التلقائي عبر /cancel في الـ proxy ====
                                        try {
                                            const cancelResp = await axios.post(
                                                `${provInfo.url}/cancel`,
                                                { orders: id.toString() },
                                                {
                                                    timeout: 20000,
                                                    headers: { 'Content-Type': 'application/json' }
                                                }
                                            );

                                            const cancelResult = cancelResp.data;

                                            // الرد عادة مصفوفة [{order: id, cancel: 1}] أو error
                                            if (Array.isArray(cancelResult) && cancelResult.length > 0) {
                                                const item = cancelResult[0];
                                                if (item.cancel === 1 || item.cancel === "1") {
                                                    await sendTelegram(`✅ <b>تم إلغاء الطلب الاحتيالي <code>${id}</code> بنجاح في ${provInfo.name}!</b>`);
                                                    stats.status.active--;
                                                    stats.status.canceled++;
                                                } else {
                                                    const errorMsg = item.error || item.cancel?.error || 'رد غير متوقع';
                                                    await sendTelegram(`⚠️ <b>فشل إلغاء الطلب <code>${id}</code>:</b> ${errorMsg}`);
                                                }
                                            } else {
                                                await sendTelegram(`⚠️ <b>فشل إلغاء الطلب <code>${id}</code>:</b> رد غير متوقع من السيرفر`);
                                            }
                                        } catch (cancelErr) {
                                            await sendTelegram(`❌ <b>خطأ في إلغاء الطلب <code>${id}</code>:</b> ${cancelErr.message || cancelErr.response?.data || 'غير معروف'}`);
                                        }

                                        // تأخير قصير بعد كل محاولة إلغاء
                                        await delay(1000);
                                    }
                                }
                            } catch (dbErr) {
                                console.log(dbErr.message);
                            }
                        }
                    }

                } catch (err) {
                    await sendTelegram(`⚠️ خطأ في الدفعة ${currentBatchStart}: ${err.message}`);
                }

                if (currentBatchEnd < endScanId) await delay(1000);
            }
        }

        // التقرير النهائي
        let finalReport = "";
        if (stats.fraudDetected === 0) {
            finalReport = "✅ <b>انتهى الفحص الشامل - لم يتم العثور على أي احتيال.</b>";
        } else {
            finalReport = 
                "📊 <b>تقرير الفحص والإحصائيات النهائية:</b>\n\n" +
                `🔴 <b>إجمالي الطلبات الاحتيالية المكتشفة: ${stats.fraudDetected}</b>\n` +
                "ــــــــــــــــــــــــــــــــــــــــــــــــ\n" +
                `🛡️ <b>الملغية (تم صدها):</b> ${stats.status.canceled}\n` +
                `💔 <b>المكتملة (خسارة):</b> ${stats.status.completed}\n` +
                `🔥 <b>النشطة (تحت المعالجة):</b> ${stats.status.active}\n` +
                "ــــــــــــــــــــــــــــــــــــــــــــــــ\n" +
                `💸 <b>إجمالي الأموال المهدرة (للطلبات المكتملة): \]{stats.lostMoney.toFixed(3)}</b>`;
        }

        finalReport += `\n\n🔎 إجمالي ما تم فحصه: ${stats.totalScanned} طلب.`;

        await sendTelegram(finalReport);

    } catch (e) {
        await sendTelegram(`❌ <b>خطأ فادح: ${e.message}</b>`);
    }
}

startScan();
