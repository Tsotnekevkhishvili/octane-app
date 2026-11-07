/* ═══════════ 📚 დამატებითი კოდების ბაზა (წყარო: ავტოექიმი - ავტორის საკუთარი აპი) ═══════════
   codes/avto-<მარკა>.json  - მარკის საკუთარი კოდები (P1xxx, B1xxx, C1xxx, U1xxx...), 31 მარკა
   codes/avto-generic.json  - სტანდარტული კოდები, რომლებიც codes.js-ში არ იყო
   ფაილები იტვირთება მხოლოდ საჭიროებისას (არჩეული მარკის ფაილი + ზოგადი), რომ აპი არ შენელდეს.
   ჩანაწერი: [სათაური, დაკავშირებული სტანდარტული კოდი?] */
(function () {
    // მანქანის მარკა (cars-db) → ფაილი
    var FILE = {
        'Bentley': 'bentley', 'BMW': 'bmw', 'MINI': 'bmw', 'BYD': 'byd', 'Changan': 'changan', 'Chery': 'chery',
        'Chrysler': 'chrysler', 'Dodge': 'chrysler', 'Jeep': 'chrysler', 'Ram': 'chrysler', 'Daihatsu': 'daihatsu',
        'Fiat': 'fiat', 'Alfa Romeo': 'fiat', 'Ford': 'ford', 'Lincoln': 'ford', 'Mercury': 'ford', 'Geely': 'geely',
        'Chevrolet': 'gm', 'GMC': 'gm', 'Cadillac': 'gm', 'Buick': 'gm', 'Pontiac': 'gm', 'Saturn': 'gm', 'Hummer': 'gm',
        'Great Wall': 'gwm', 'Haval': 'gwm', 'Honda': 'honda', 'Acura': 'honda', 'Hyundai': 'hyundai', 'Kia': 'hyundai',
        'Genesis': 'hyundai', 'Isuzu': 'isuzu', 'JAC': 'jac', 'Jaguar': 'jlr', 'Land Rover': 'jlr', 'Lamborghini': 'lamborghini',
        'Mazda': 'mazda', 'Mercedes-Benz': 'mercedes', 'Smart': 'mercedes', 'Mitsubishi': 'mitsubishi', 'Nissan': 'nissan',
        'Infiniti': 'nissan', 'Opel': 'opel', 'Porsche': 'porsche', 'Peugeot': 'psa', 'Citroën': 'psa', 'Renault': 'renault',
        'Dacia': 'renault', 'Subaru': 'subaru', 'Suzuki': 'suzuki', 'Toyota': 'toyota', 'Lexus': 'toyota', 'Scion': 'toyota',
        'Volkswagen': 'vag', 'Audi': 'vag', 'Škoda': 'vag', 'SEAT': 'vag', 'Cupra': 'vag', 'Volvo': 'volvo'
    };
    // ძველი ჯგუფის გასაღები (index.html carBrand) → ფაილი, თუ ზუსტი მარკა უცნობია
    var GROUP = { toyota: 'toyota', nissan: 'nissan', hyundai: 'hyundai', vag: 'vag', ford: 'ford', gm: 'gm', honda: 'honda',
                  subaru: 'subaru', bmw: 'bmw', mercedes: 'mercedes', mazda: 'mazda', mitsubishi: 'mitsubishi', opel: 'opel' };

    var cache = {}, pending = {};
    function load(key) {
        if (!key || cache[key] || pending[key]) return pending[key] || Promise.resolve();
        pending[key] = fetch('codes/avto-' + key + '.json').then(function (r) { return r.ok ? r.json() : {}; })
            .then(function (j) { cache[key] = j || {}; delete pending[key]; try { window.dispatchEvent(new CustomEvent('octane-codes')); } catch (e) {} })
            .catch(function () { delete pending[key]; });
        return pending[key];
    }
    function carBrand() { try { return Alpine.store('car').brand || ''; } catch (e) { return ''; } }
    function keyFor(group) { return FILE[carBrand()] || (group && GROUP[group]) || ''; }

    window.OCTANE_AVTO = {
        // არჩეული მარკის + ზოგადი ფაილის წინასწარ ჩატვირთვა
        preload: function (group) { load('generic'); load(keyFor(group)); },
        // მარკის კოდი: { title, rel } ან null
        brand: function (code, group) {
            var k = keyFor(group), t = k && cache[k] && cache[k][code];
            if (!t) { if (k) load(k); return null; }
            return { title: t[0], rel: t[1] || '' };
        },
        generic: function (code) {
            var t = cache.generic && cache.generic[code];
            if (!t) { load('generic'); return null; }
            return { title: t[0], rel: t[1] || '' };
        }
    };

    window.OCTANE_AVTO.preload();
    window.addEventListener('octane-car', function () { window.OCTANE_AVTO.preload(); });
    document.addEventListener('alpine:initialized', function () { window.OCTANE_AVTO.preload(); });
})();
