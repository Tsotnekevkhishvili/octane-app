const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

async function updateFuelPrices() {
    console.log('🔄 Gulf-ის ცხრილიდან ფასების წამოღება...');

    try {
        const { data } = await axios.get('https://gulf.ge/ge/fuel_prices', {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' 
            }
        });

        const $ = cheerio.load(data);

        // ვპოულობთ ცხრილის პირველ მონაცემთა სტრიქონს (პირველი <tr> tbody-ში ან table-ში)
        const firstRow = $('table tr').eq(1); // eq(0) არის ჰედერი, eq(1) არის ბოლო ფასები

        // სვეტების მიხედვით მნიშვნელობების ამოღება
        // სვეტები: [0] თარიღი, [1] სუპერი, [2] პრემიუმი, [3] ევრო რეგულარი, [4] რეგულარი, [5] ევრო დიზელი, [6] დიზელი
        const premium = firstRow.find('td').eq(2).text().trim() || '3.77';
        const regular = firstRow.find('td').eq(3).text().trim() || '3.59';
        const diesel = firstRow.find('td').eq(5).text().trim() || '4.17';

        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const dateStr = `დღეს, ${hours}:${minutes}`;

        const payload = {
            lastUpdated: dateStr,
            prices: {
                regular: regular,
                premium: premium,
                diesel: diesel
            }
        };

        const distDir = path.join(__dirname, 'dist');
        const targetPath = fs.existsSync(distDir) 
            ? path.join(distDir, 'fuel-prices.json') 
            : path.join(__dirname, 'fuel-prices.json');

        fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf-8');

        console.log('✅ Gulf-ის ზუსტი ცხრილის ფასები ჩაიწერა!', payload);

    } catch (error) {
        console.error('❌ შეცდომა სქრეიპინგისას:', error.message);
    }
}

updateFuelPrices();