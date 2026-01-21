const mysql = require('mysql2/promise');
const axios = require('axios');

// الإعدادات - سيتم جلبها من GitHub Secrets للأمان
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
};

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const providers_map = {
    'peakerr_prox': { name: 'Peakerr', url: 'https://peakerr-status-2.onrender.com' },
    'trendfly_prox': { name: 'Trendfly', url: 'https://trendfly-status.onrender.com' },
    'More_prox': { name: 'More', url: 'https://smm-status.onrender.com' }
};

async function sendTelegram(message) {
    if (!TELEGRAM_TOKEN) return;
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    try {
        await axios.post(url, { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' });
    } catch (e) { console.error("خطأ في إرسال تليجرام"); }
}

async function startScan() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log("تم الاتصال بقاعدة البيانات...");

        // 1. جلب آخر ID لكل مزود من قاعدتك
        const [rows] = await connection.execute(`
            SELECT api_provider, MAX(api_order_id) as last_id 
            FROM orders 
            WHERE api_provider IS NOT NULL AND api_order_id REGEXP '^[0-9]+$'
            GROUP BY api_provider
        `);

        for (const row of rows) {
            const provKey = row.api_provider;
            if (!providers_map[provKey]) continue;

            const lastId = parseInt(row.last_id);
            const provInfo = providers_map[provKey];
            
            console.log(`فحص مزود: ${provInfo.name} من بعد الطلب: ${lastId}`);

            // 2. فحص 100 طلب تالي (Batch)
            const nextIds = Array.from({length: 100}, (_, i) => lastId + 1 + i);
            
            try {
                const response = await axios.post(`${provInfo.url}/orders`, { orders: nextIds.join(',') });
                const results = response.data;

                for (const id of nextIds) {
                    const orderData = results[id] || results[id.toString()];
                    
                    if (orderData && orderData.status && !/error|not found/i.test(orderData.status)) {
                        // الطلب موجود عند المزود.. هل هو موجود عندك؟
                        const [check] = await connection.execute('SELECT id FROM orders WHERE api_order_id = ?', [id]);
                        
                        if (check.length === 0) {
                            // احتيال مكتشف!
                            const msg = `🚨 <b>اكتشاف طلب احتيالي!</b>\n\n` +
                                        `📌 المزود: ${provInfo.name}\n` +
                                        `🆔 رقم الطلب: <code>${id}</code>\n` +
                                        `📊 الحالة: ${orderData.status}\n` +
                                        `💰 التكلفة: ${orderData.charge || '?'}`;
                            
                            console.log(`! احتيال: ${id}`);
                            await sendTelegram(msg);

                            // اختيارياً: يمكنك إضافة كود هنا لإرسال طلب إلغاء (Cancel) تلقائي للمزود
                        }
                    }
                }
            } catch (err) {
                console.error(`خطأ في فحص مزود ${provInfo.name}`);
            }
        }

    } catch (err) {
        console.error("خطأ عام:", err.message);
    } finally {
        if (connection) await connection.end();
    }
}

startScan();
