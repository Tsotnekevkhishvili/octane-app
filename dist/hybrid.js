/* ═══════════ 🔋 ჰიბრიდის / ელექტრომობილის ბატარეის შემოწმება (წყარო: ავტოექიმი - ავტორის საკუთარი აპი) ═══════════
   ჩანს მხოლოდ ჰიბრიდზე/ელექტრომობილზე („ჩემი მანქანა“ → საწვავი, ან მოდელი თავისთავად ჰიბრიდია: Prius, Aqua, Leaf...).
   კითხულობს ბატარეის ბლოკების/უჯრედების ძაბვებს და აფასებს ბალანსს (ყველაზე მაღალსა და დაბალს შორის სხვაობა).
   მონაცემი ნაჩვენებია მხოლოდ მაშინ, თუ ყველა მნიშვნელობა რეალისტურია - სხვა შემთხვევაში „ვერ წავიკითხეთ“.
   ეს არ არის ბატარეის „ჯანმრთელობის პროცენტი“ (SOH). */
(function () {
    // ─── პროფილები ───
    // Toyota gen3: 7E2 → 2181, V = სიტყვა × 79.99 / 65535 (Prius 2010-15, Aqua/Prius c, CT200h, RAV4 2017)
    // Toyota gen2: 7E3 → 21CE, V = სიტყვა / 100 − 327.68 (Prius 2004-09)
    // Toyota TNGA: 747 → 221F5B (Prius 2016+, RAV4 2018+, Camry, C-HR, Corolla...) - ტესტის რეჟიმი
    // Nissan Leaf: 79B → 2102, უჯრედი = სიტყვა / 1000 V (96 უჯრედი)
    // Hyundai/Kia: 7E4 → 2102-2104 (ძველი) ან 220102-220104 (ახალი), უჯრედი = ბაიტი × 0.02 V
    function yr(c) { return parseInt(c.year, 10) || 0; }
    function has(re, c) { return re.test(c.model || ''); }

    function profileFor(c) {
        var b = c.brand || '', y = yr(c), fuel = (c.info && c.info.fuel) || '';
        var hybridFuel = fuel === 'ჰიბრიდი', evFuel = fuel === 'ელექტრო';
        if (/^(Toyota|Lexus)$/.test(b)) {
            if (has(/\b(Aqua|Prius\s*c)\b/i, c) && (!y || (y >= 2012 && y <= 2020))) return { id: 'tgen3', label: 'Toyota Aqua / Prius c', kind: 'nimh', tx: '7E2', rx: '7EA', cmds: ['2181'], count: 10 };
            if (has(/\bPrius\b/i, c) && !has(/Prime|Plug/i, c)) {
                if (y >= 2004 && y <= 2009) return { id: 'tgen2', label: 'Toyota Prius (2-ე თაობა)', kind: 'nimh', tx: '7E3', rx: '7EB', cmds: ['21CE'], count: 14 };
                if (y >= 2010 && y <= 2015) return { id: 'tgen3', label: 'Toyota Prius (3-ე თაობა)', kind: 'nimh', tx: '7E2', rx: '7EA', cmds: ['2181'], count: 14 };
                if (y >= 2016) return { id: 'tnga', label: 'Toyota Prius (4-ე თაობა+)', kind: 'auto', tx: '747', rx: '74F', cmds: ['221F5B'], exp: true };
                return { id: 'tgen3', label: 'Toyota Prius', kind: 'nimh', tx: '7E2', rx: '7EA', cmds: ['2181'], count: 14 };
            }
            if (b === 'Lexus' && has(/\bCT\b|CT\s*-?\s*200/i, c)) return { id: 'tgen3', label: 'Lexus CT200h', kind: 'nimh', tx: '7E2', rx: '7EA', cmds: ['2181'], count: 14 };
            if (hybridFuel && has(/RAV\s*-?\s*4/i, c) && y === 2017) return { id: 'tgen3', label: 'Toyota RAV4 Hybrid 2017', kind: 'nimh', tx: '7E2', rx: '7EA', cmds: ['2181'], count: 17 };
            if (hybridFuel) return { id: 'tnga', label: b + ' ' + (c.model || '') + ' Hybrid', kind: 'auto', tx: '747', rx: '74F', cmds: ['221F5B'], exp: true };
            return null;
        }
        if (b === 'Nissan' && (has(/\bLeaf\b/i, c) || evFuel)) return { id: 'leaf', label: 'Nissan Leaf', kind: 'li', tx: '79B', rx: '7BB', fc: true, cmds: ['2102'], words: 1000 };
        if (/^(Hyundai|Kia|Genesis)$/.test(b)) {
            var egmp = has(/Ioniq\s*[56]|EV\s*[69]|GV60/i, c);
            var ev = evFuel || egmp || has(/Ioniq\s*Electric|e-?Niro|Niro\s*EV|Kona\s*(Electric|EV)|Soul\s*EV/i, c);
            var hev = !ev && (hybridFuel || has(/Hybrid|HEV|PHEV/i, c) || (has(/\bIoniq\b|\bNiro\b/i, c) && !evFuel));
            if (ev || hev) return {
                id: 'hkmc', label: b + ' ' + (c.model || '') + (ev ? ' (ელექტრო)' : ' (ჰიბრიდი)'), kind: 'li', tx: '7E4', rx: '7EC',
                cmds: egmp ? ['220102', '220103', '220104'] : ['2102', '2103', '2104'], alt: egmp ? null : ['220102', '220103', '220104'], exp: hev
            };
            return null;
        }
        return null;
    }

    // ─── ჰიბრიდი/ელექტრო? (არაჰიბრიდზე ფუნქცია საერთოდ არ ჩანს) ───
    function applies(c) {
        var fuel = (c.info && c.info.fuel) || '';
        if (fuel === 'ჰიბრიდი' || fuel === 'ელექტრო') return true;
        if (/\b(Prius|Aqua|Leaf|Ioniq|Niro|CT\s*-?\s*200h)\b|Hybrid|HEV/i.test(c.model || '')) return true;
        return false;
    }

    // ─── ELM: მრავალნაწილიანი (ISO-TP) პასუხის ბაიტები SID/PID-ის შემდეგ ───
    function bytesAfter(app, raw, cmd) {
        var c = app.cleanELMResponse(raw, cmd), hex = '';
        for (var i = 0; i < c.lines.length; i++) {
            var l = c.lines[i];
            if (app.isErrorResponse(l)) continue;
            var s = l.replace(/\s+/g, '').toUpperCase();
            if (/^[0-9A-F]{3}$/.test(s)) continue;            // სიგრძის ხაზი
            s = s.replace(/^[0-9A-F]:/, '');
            if (!/^[0-9A-F]+$/.test(s)) continue;
            hex += s;
        }
        var head = (parseInt(cmd.slice(0, 2), 16) + 0x40).toString(16).toUpperCase() + cmd.slice(2).toUpperCase();
        var k = hex.indexOf(head);
        while (k > 0 && k % 2) k = hex.indexOf(head, k + 1);
        if (k < 0) return null;
        var data = hex.slice(k + head.length), out = [];
        for (var j = 0; j + 2 <= data.length; j += 2) out.push(parseInt(data.substr(j, 2), 16));
        return out;
    }
    function words(b, off) { var w = []; for (var i = off; i + 1 < b.length; i += 2) w.push(b[i] * 256 + b[i + 1]); return w; }
    function r3(v) { return Math.round(v * 1000) / 1000; }
    function all(a, lo, hi) { return a.length > 0 && a.every(function (v) { return v >= lo && v <= hi; }); }

    // ─── მნიშვნელობების გამოთვლა + რეალისტურობის შემოწმება ───
    function decode(p, replies) {
        var b = replies[0];
        if (p.id === 'tgen3' || p.id === 'tgen2') {
            if (!b) return null;
            for (var off = 0; off <= 3; off++) {
                var w = words(b, off).slice(0, p.count);
                if (w.length < p.count) continue;
                var v = w.map(function (x) { return r3(p.id === 'tgen3' ? x * 79.99 / 65535 : x / 100 - 327.68); });
                if (all(v, 10, 20)) return { unit: 'block', values: v };
            }
            return null;
        }
        if (p.id === 'tnga') {
            if (!b) return null;
            for (var o = 0; o <= 3; o++) {
                var ww = words(b, o).filter(function (x) { return x > 0 && x < 65535; });
                var v1 = ww.map(function (x) { return r3(x / 1000); });
                if (v1.length >= 10 && all(v1, 10, 20)) return { unit: 'block', values: v1 };
                if (v1.length >= 20 && all(v1, 1.0, 1.6)) return { unit: 'cell', chem: 'nimh', values: v1 };
                if (v1.length >= 20 && all(v1, 2.5, 4.35)) return { unit: 'cell', chem: 'li', values: v1 };
            }
            return null;
        }
        if (p.id === 'leaf') {
            if (!b) return null;
            for (var o2 = 0; o2 <= 3; o2++) {
                var lv = words(b, o2).slice(0, 96).map(function (x) { return r3(x / 1000); });
                if (lv.length >= 88 && all(lv, 2.5, 4.35)) return { unit: 'cell', chem: 'li', values: lv };
            }
            return null;
        }
        if (p.id === 'hkmc') {
            var cells = [];
            for (var i = 0; i < replies.length; i++) {
                var r = replies[i];
                if (!r || r.length < 36) break;
                var part = r.slice(4, 36).map(function (x) { return r3(x * 0.02); });   // 4 ბაიტი ნიშნულები + 32 უჯრედი
                if (!all(part, 2.5, 4.35)) return null;
                cells = cells.concat(part);
            }
            return cells.length >= 32 ? { unit: 'cell', chem: 'li', values: cells } : null;
        }
        return null;
    }

    // ─── შეფასება ───
    function evaluate(d) {
        var v = d.values, min = Math.min.apply(null, v), max = Math.max.apply(null, v), spread = r3(max - min);
        var lim = d.unit === 'block' ? [0.3, 0.6] : (d.chem === 'nimh' ? [0.05, 0.1] : [0.04, 0.1]);
        var tone = spread <= lim[0] ? 'green' : (spread <= lim[1] ? 'amber' : 'red');
        var weak = v.indexOf(min) + 1;
        var noun = d.unit === 'block' ? 'ბლოკი' : 'უჯრედი';
        var title = tone === 'green' ? 'ბატარეა დაბალანსებულია' : (tone === 'amber' ? 'მცირე დისბალანსია' : noun + ' №' + weak + ' სხვებზე სუსტია');
        var text = tone === 'green' ? 'ყველა ' + (d.unit === 'block' ? 'ბლოკის' : 'უჯრედის') + ' ძაბვა ახლოსაა ერთმანეთთან.'
                 : tone === 'amber' ? 'სხვაობა ცოტა გაიზარდა. რეკომენდებულია გამეორება რამდენიმე კვირაში.'
                 : 'სხვაობა დიდია - ბატარეა სერვისში შეამოწმეთ (ბლოკის/უჯრედის დიაგნოსტიკა, ბალანსირება).';
        return { tone: tone, title: title, text: text, min: r3(min), max: r3(max), spread: spread, weak: tone === 'green' ? 0 : weak, avg: r3(v.reduce(function (a, x) { return a + x; }, 0) / v.length) };
    }

    // ─── წაკითხვა სკანერით ───
    async function readAll(app, p) {
        var send = function (c, t) { return app.sendELMCommand(c, t || 3000); };
        var setup = ['AT SH ' + p.tx, 'AT CRA ' + p.rx];
        if (p.fc) setup = setup.concat(['AT FC SH ' + p.tx, 'AT FC SD 30 00 00', 'AT FC SM 1']);
        for (var i = 0; i < setup.length; i++) await send(setup[i], 2000);
        try {
            var tryCmds = async function (cmds) {
                var out = [];
                for (var j = 0; j < cmds.length; j++) {
                    var raw = await send(cmds[j], 5000);
                    if (app.elmTimedOut && app.elmResync) await app.elmResync();
                    out.push(bytesAfter(app, raw, cmds[j]));
                }
                return out;
            };
            var replies = await tryCmds(p.cmds);
            var d = decode(p, replies);
            if (!d && p.alt) d = decode(p, await tryCmds(p.alt));
            return d;
        } finally {
            // ჩვეულებრივ რეჟიმში დაბრუნება (სხვა ფუნქციებმა ისე იმუშაოს, როგორც ადრე)
            if (p.fc) await send('AT FC SM 0', 2000);
            await send('AT CRA', 2000);
            await send('AT AR', 2000);
            await send('AT SH 7DF', 2000);
        }
    }

    document.addEventListener('alpine:init', function () {
        window.Alpine.store('hv', {
            open: false, state: 'idle', result: null, profile: null, err: '',
            car: function () { try { return Alpine.store('car'); } catch (e) { return null; } },
            // ჩანს მხოლოდ ჰიბრიდზე/ელექტრომობილზე, რომლისთვისაც შემოწმების მეთოდი გვაქვს
            get applies() { var c = this.car(); return !!(c && c.brand && applies(c) && profileFor(c)); },
            get prof() { var c = this.car(); return c ? profileFor(c) : null; },
            get kindLabel() {
                var c = this.car(), p = this.prof || {};
                var ev = (c && c.info && c.info.fuel === 'ელექტრო') || p.id === 'leaf' || /ელექტრო/.test(p.label || '');
                return ev ? 'ელექტრომობილის ბატარეა' : 'ჰიბრიდის ბატარეა';
            },
            show: function () { this.open = true; if (this.state !== 'run') { this.state = 'idle'; this.err = ''; } },
            close: function () { if (this.state !== 'run') this.open = false; },
            start: async function () {
                var app = null;
                try { app = Alpine.$data(document.getElementById('diagnostic-app')); } catch (e) {}
                var p = this.prof;
                if (!p) { this.state = 'unsupported'; return; }
                if (!app || !app.connected) { this.state = 'noconn'; return; }
                if (app.loading) return;
                if (app.liveStreaming) app.toggleLiveStream();
                this.state = 'run'; this.result = null; this.err = '';
                app.loading = true;
                try {
                    var d = await readAll(app, p);
                    if (!d) { this.state = 'fail'; return; }
                    var e = evaluate(d);
                    var lo = Math.min(e.min, e.max - 0.001), hi = e.max, pad = Math.max((hi - lo) * 0.6, d.unit === 'block' ? 0.3 : 0.03);
                    this.result = Object.assign({ unit: d.unit, values: d.values, exp: !!p.exp, label: p.label, base: lo - pad, top: hi + pad / 3 }, e);
                    this.state = 'done';
                    try { localStorage.setItem('octane_hv_last', JSON.stringify({ at: Date.now(), tone: e.tone, spread: e.spread, unit: d.unit })); } catch (x) {}
                } catch (e2) {
                    this.state = 'fail';
                } finally {
                    app.loading = false;
                }
            },
            barW: function (v) { var r = this.result; if (!r) return 0; return Math.max(4, Math.min(100, (v - r.base) / (r.top - r.base) * 100)); },
            fmt: function (v) { return (this.result && this.result.unit === 'cell' ? v.toFixed(3) : v.toFixed(2)) + ' V'; }
        });
    });
    window.OCTANE_HV = { profileFor: profileFor, applies: applies, decode: decode, evaluate: evaluate, bytesAfter: bytesAfter };
})();
