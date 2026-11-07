/* ═══════════ 🚗 „ჩემი მანქანა“ - ბრენდი, მოდელი, ძარის ტიპი, სახელი და ფოტო (ყველაფერი სურვილისამებრ) ═══════════
   ინახება ტელეფონში (localStorage). ბრენდები/მოდელები: cars-db.js, ძარის ტიპი: car-body.js.
   ფოტო არჩევისას პატარავდება (მაქს. 1280px, JPEG), რომ მეხსიერება არ გაივსოს.
   ჩვენება: საკუთარი ფოტო → 3D მოდელი (ძარის ტიპით, თუ ფაილი არსებობს) → ნაგულისხმევი ფოტო. */
(function () {
    var KEY = 'octane_car';
    var DEFAULT_NAME = 'ჩემი მანქანა';
    var DEFAULT_PHOTO = 'img/default-car.webp';

    function load() {
        try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function save(o) {
        try { localStorage.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
    }

    function shrink(file) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onerror = function () { reject(new Error('read')); };
            reader.onload = function () {
                var img = new Image();
                img.onerror = function () { reject(new Error('image')); };
                img.onload = function () {
                    var max = 1280, w = img.naturalWidth, h = img.naturalHeight;
                    var k = Math.min(1, max / Math.max(w, h));
                    var c = document.createElement('canvas');
                    c.width = Math.round(w * k); c.height = Math.round(h * k);
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    resolve(c.toDataURL('image/jpeg', 0.85));
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function cars() { return window.OCTANE_CARS || {}; }
    function body() { return window.OCTANE_BODY || { types: [], guess: function () { return 'sedan'; }, label: function () { return ''; } }; }

    document.addEventListener('alpine:init', function () {
        var saved = load();
        window.Alpine.store('car', {
            name: saved.name || '',
            photo: saved.photo || '',
            brand: saved.brand || '',
            model: saved.model || '',
            body: saved.body || '',
            open: false,
            draftName: '', draftPhoto: '', draftBrand: '', draftModel: '', draftBody: '', bodyManual: false,
            busy: false,
            error: '',

            get autoName() { return [this.brand, this.model].filter(Boolean).join(' '); },
            get title() { return this.name || this.autoName || DEFAULT_NAME; },
            get src() { return this.photo || DEFAULT_PHOTO; },
            get custom() { return !!this.photo; },
            get draftSrc() { return this.draftPhoto || DEFAULT_PHOTO; },
            get draftAutoName() { return [this.draftBrand, this.draftModel].filter(Boolean).join(' '); },

            get brands() { return Object.keys(cars()); },
            get models() { return cars()[this.draftBrand] || []; },
            get bodyTypes() { return body().types; },
            bodyLabel: function (k) { return body().label(k); },

            openEdit: function () {
                this.draftName = this.name;
                this.draftPhoto = this.photo;
                this.draftBrand = this.brand;
                this.draftModel = this.model;
                this.draftBody = this.body || (this.model ? body().guess(this.brand, this.model) : '');
                this.bodyManual = !!this.body && this.body !== body().guess(this.brand, this.model);
                this.error = '';
                this.open = true;
            },
            close: function () { this.open = false; },

            brandChanged: function () {
                this.draftModel = '';
                if (!this.bodyManual) this.draftBody = '';
            },
            modelChanged: function () {
                if (!this.bodyManual && this.draftModel) this.draftBody = body().guess(this.draftBrand, this.draftModel);
            },
            pickBody: function (k) { this.draftBody = k; this.bodyManual = true; },

            pick: async function (ev) {
                var f = ev && ev.target && ev.target.files && ev.target.files[0];
                if (ev && ev.target) ev.target.value = '';
                if (!f) return;
                this.busy = true; this.error = '';
                try { this.draftPhoto = await shrink(f); }
                catch (e) { this.error = 'ფოტო ვერ გაიხსნა. სცადე სხვა ფოტო.'; }
                this.busy = false;
            },
            resetPhoto: function () { this.draftPhoto = ''; },

            submit: function () {
                var o = {
                    name: String(this.draftName || '').trim().slice(0, 40),
                    brand: String(this.draftBrand || '').trim().slice(0, 40),
                    model: String(this.draftModel || '').trim().slice(0, 40),
                    body: this.draftBody || '',
                    photo: this.draftPhoto || ''
                };
                if (!save(o)) {
                    // ტელეფონის მეხსიერება სავსეა - ფოტოს გარეშე მაინც შევინახოთ დანარჩენი
                    o.photo = '';
                    save(o);
                    this.error = 'ფოტო ვერ შეინახა - ტელეფონის მეხსიერება სავსეა.';
                    Object.assign(this, o);
                    return;
                }
                Object.assign(this, o);
                this.open = false;
            }
        });
    });
})();
