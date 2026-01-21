const axios = require('axios');

const PROXY_URL = 'https://trendfly-status.onrender.com';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;  // من secrets
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;  // من secrets

async function sendTelegram(message) {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error("Telegram credentials missing!");
        return;
    }
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
        console.log("تم إرسال الرسالة إلى Telegram");
    } catch (e) {
        console.error("Telegram Error:", e.message);
    }
}

async function testSingleOrder() {
    let resultMessage = "<b>🧪 اختبار حالة طلب واحد في Trendfly</b>\n\n";
    resultMessage += "<b>الطلب:</b> <code>89336</code>\n\n";

    try {
        // إيقاظ الـ proxy
        await axios.get(PROXY_URL, { timeout: 15000 });
        resultMessage += "✅ تم إيقاظ الـ proxy بنجاح\n";

        // جلب حالة الطلب الواحد
        const payload = { orders: '89336' };

        const config = {
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        };

        const response = await axios.post(`${PROXY_URL}/orders`, payload, config);
        
        const result = response.data['89336'] || response.data[89336] || response.data;

        if (result && result.status) {
            resultMessage += `<b>الحالة:</b> ${result.status}\n`;
            if (result.charge) resultMessage += `<b>التكلفة:</b> ${result.charge}\n`;
            if (result.remains) resultMessage += `<b>المتبقي:</b> ${result.remains}\n`;
            if (result.start_count) resultMessage += `<b>البداية:</b> ${result.start_count}\n`;
            resultMessage += "\n✅ الطلب موجود في الـ proxy";
        } else if (result && result.error) {
            resultMessage += `<b>خطأ:</b> ${result.error}\n`;
            resultMessage += "\n⚠️ رد خطأ من الـ proxy";
        } else {
            resultMessage += "<b>الرد:</b> غير موجود أو فارغ\n";
            resultMessage += "\nℹ️ الطلب غير موجود في الـ proxy";
        }

    } catch (err) {
        resultMessage += `<b>خطأ في الاتصال:</b> ${err.message}\n`;
        if (err.response) {
            resultMessage += `<b>رد السيرفر:</b> ${JSON.stringify(err.response.data)}\n`;
        }
        resultMessage += "\n❌ فشل الاختبار";
    }

    // إرسال النتيجة الكاملة إلى Telegram
    await sendTelegram(resultMessage);
}

testSingleOrder();
