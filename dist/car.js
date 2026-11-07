/* ═══════════ 🚗 „ჩემი მანქანა“ - სახელი და ფოტო (სურვილისამებრ) ═══════════
   ინახება ტელეფონში (localStorage). ფოტო არჩევისას პატარავდება (მაქს. 1280px, JPEG), რომ მეხსიერება არ გაივსოს.
   ფოტოს გარეშე ჩანს ნაგულისხმევი მანქანა (img/default-car.webp).
   გამოყენება: $store.car.name, $store.car.src, $store.car.custom, $store.car.openEdit() */
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

    // ფოტოს შემცირება: მაქს. 1280px გრძელ მხარეზე, JPEG 0.85
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

    document.addEventListener('alpine:init', function () {
        var saved = load();
        window.Alpine.store('car', {
            name: saved.name || '',
            photo: saved.photo || '',
            open: false,
            // რედაქტირების ფორმის დროებითი მნიშვნელობები
            draftName: '',
            draftPhoto: '',
            busy: false,
            error: '',

            get title() { return this.name || DEFAULT_NAME; },
            get src() { return this.photo || DEFAULT_PHOTO; },
            get custom() { return !!this.photo; },
            get draftSrc() { return this.draftPhoto || DEFAULT_PHOTO; },

            openEdit: function () {
                this.draftName = this.name;
                this.draftPhoto = this.photo;
                this.error = '';
                this.open = true;
            },
            close: function () { this.open = false; },

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
                var name = String(this.draftName || '').trim().slice(0, 40);
                var o = { name: name, photo: this.draftPhoto || '' };
                if (!save(o)) {
                    // ტელეფონის მეხსიერება სავსეა - ფოტოს გარეშე მაინც შევინახოთ სახელი
                    o.photo = '';
                    save(o);
                    this.error = 'ფოტო ვერ შეინახა - ტელეფონის მეხსიერება სავსეა.';
                    this.name = name; this.photo = '';
                    return;
                }
                this.name = name; this.photo = o.photo;
                this.open = false;
            }
        });
    });
})();
