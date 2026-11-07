/* ═══════════ 📈 Live Data - გაფართოებული მაჩვენებლები (წყარო: Obede - ავტორის საკუთარი აპი) ═══════════
   სახელები, ახსნები და ზღვრები Obede-დან; ფორმულები - SAE J1979 (სერვისი 01).
   index.html-ის readExtraLiveData() ყოველ ციკლზე იძახებს OCTANE_LIVE.tick(app)-ს: ჯერ ერთხელ იგებს
   მხარდაჭერილ PID-ებს, მერე რიგრიგობით კითხულობს 4-4 დამატებით მაჩვენებელს (განახლება არ ნელდება). */
(function () {
    var META = {"0C": {"label": "ძრავის ბრუნები", "technical": "RPM", "unit": "ბრ/წთ", "category": "primary", "priority": 1, "meaning": "გიჩვენებთ ძრავის ლილვის ბრუნვას ერთ წუთში. უქმ სვლაზე ნორმა 600-დან 900-მდე მერყეობს.", "attention": "არასტაბილური ან მაღალი ბრუნები ხშირად ჰაერის მიწოდების ან ანთების სისტემის ხარვეზზე მიუთითებს.", "short": "ბრუნები"}, "0D": {"label": "ავტომობილის სიჩქარე", "unit": "კმ/სთ", "category": "primary", "priority": 2, "meaning": "ავტომობილის რეალური სიჩქარე ძრავის კომპიუტერის მონაცემებზე დაყრდნობით.", "short": "სიჩქარე"}, "05": {"label": "ძრავის ტემპერატურა", "technical": "გამაგრილებელი სითხე (ანტიფრიზი)", "unit": "°C", "category": "primary", "priority": 3, "meaning": "ანტიფრიზის მიმდინარე ტემპერატურა. დაქოქვის შემდეგ ძრავს სამუშაო ტემპერატურამდე მიღწევა სჭირდება.", "attention": "ტემპერატურის უჩვეულო მატება გაგრილების სისტემის გაუმართაობაზე მიუთითებს და დაუყოვნებლივ შემოწმებას საჭიროებს.", "short": "ძრავის ტემპ."}, "42": {"label": "ბორტქსელის ძაბვა", "technical": "ECU კვება", "unit": "V", "category": "primary", "priority": 4, "decimals": 1, "meaning": "ძაბვა, რომელსაც ძრავის კომპიუტერი იღებს. ჩაქრობილზე აჩვენებს აკუმულატორის მუხტს, ხოლო დაქოქილზე გენერატორის მუშაობას.", "attention": "დაქოქილ ძრავზე მუდმივად დაბალი ძაბვა გენერატორის ან მისი ღვედის პრობლემაზე მიანიშნებს.", "short": "ძაბვა"}, "04": {"label": "ძრავის დატვირთვა", "unit": "%", "category": "primary", "priority": 5, "meaning": "აჩვენებს, თუ რამდენად დატვირთულია ძრავი მის მაქსიმალურ შესაძლებლობასთან შედარებით. უქმ სვლაზე პროცენტი დაბალია და აჩქარებისას იზრდება.", "short": "დატვირთვა"}, "06": {"label": "საწვავის კორექცია (მოკლევადიანი)", "technical": "მოკლევადიანი Bank 1", "unit": "%", "category": "fuel", "priority": 1, "decimals": 1, "meaning": "გიჩვენებთ, როგორ არეგულირებს კომპიუტერი საწვავის მიწოდებას ამ კონკრეტულ წამში. ნული იდეალური მაჩვენებელია.", "attention": "მაღალი დადებითი მაჩვენებელი სისტემაში ზედმეტი ჰაერის მოხვედრას ნიშნავს, ხოლო უარყოფითი ჭარბ საწვავს."}, "07": {"label": "საწვავის კორექცია (გრძელვადიანი)", "technical": "გრძელვადიანი Bank 1", "unit": "%", "category": "fuel", "priority": 2, "decimals": 1, "meaning": "კომპიუტერის მიერ დამახსოვრებული საწვავის კორექციის ისტორია. მოკლევადიანისგან განსხვავებით, ეს მაჩვენებელი დროთა განმავლობაში ყალიბდება.", "attention": "თუ მაჩვენებელი ნულიდან მკვეთრად გადახრილია, აუცილებელია საწვავისა და ჰაერის მიწოდების სისტემების შემოწმება."}, "11": {"label": "დროსელის პოზიცია", "unit": "%", "category": "fuel", "priority": 3, "meaning": "გიჩვენებთ, რამდენად ღიაა დროსელის სარქველი. სატერფულიდან ფეხის აღებისას მაჩვენებელი ნულთან ახლოს უნდა იყოს.", "short": "დროსელი"}, "0F": {"label": "შემშვები ჰაერის ტემპერატურა", "technical": "IAT სენსორი", "unit": "°C", "category": "fuel", "priority": 4, "meaning": "ძრავში შემავალი ჰაერის ტემპერატურა. მაჩვენებელი დამოკიდებულია გარემოსა და ძრავის ტემპერატურაზე."}, "77": {"label": "ინტერკულერის ტემპერატურა", "technical": "CACT სენსორი", "unit": "°C", "category": "fuel", "priority": 5, "meaning": "ინტერკულერიდან გამოსული ჰაერის ტემპერატურა. ტურბოს შემდეგ ჰაერი ცხელდება და ინტერკულერი მას აგრილებს. რაც უფრო გრილია, მით უკეთესი. ყველა ავტომობილს ეს სენსორი არ აქვს."}, "10": {"label": "ჰაერის ნაკადი", "technical": "MAF სენსორი", "unit": "გ/წმ", "category": "fuel", "priority": 5, "decimals": 2, "meaning": "აჩვენებს, წამში რამდენი გრამი ჰაერი შედის ძრავში. ძრავის ბრუნების ზრდასთან ერთად ეს მაჩვენებელიც იმატებს."}, "0B": {"label": "კოლექტორის წნევა", "technical": "MAP სენსორი", "unit": "kPa", "category": "fuel", "priority": 6, "meaning": "ჰაერის წნევა შემშვებ კოლექტორში. უქმ სვლაზე ატმოსფერულ წნევაზე დაბალია, ხოლო აჩქარებისას მას უახლოვდება."}, "2F": {"label": "საწვავის დონე", "unit": "%", "category": "fuel", "priority": 7, "meaning": "ავზში დარჩენილი საწვავის რაოდენობა პროცენტულად. გაითვალისწინეთ, რომ ყველა მოდელი არ აწვდის ამ ინფორმაციას კომპიუტერს."}, "0E": {"label": "ანთების კუთხე", "technical": "Timing Advance", "unit": "°", "category": "engine", "priority": 1, "decimals": 1, "meaning": "გიჩვენებთ, რამდენად ადრე ხდება ნაპერწკლის მიწოდება ცილინდრში. კომპიუტერი ამ კუთხეს დატვირთვისა და ბრუნების მიხედვით მუდმივად ცვლის."}, "43": {"label": "აბსოლუტური დატვირთვა", "unit": "%", "category": "engine", "priority": 2, "meaning": "ძრავის დატვირთვა აბსოლუტურ მასშტაბში. ძლიერი აჩქარებისას მაჩვენებელი შეიძლება 100 პროცენტსაც ასცდეს."}, "5C": {"label": "ზეთის ტემპერატურა", "unit": "°C", "category": "engine", "priority": 3, "meaning": "ზეთის მიმდინარე ტემპერატურა ძრავში. ეს სენსორი ყველა ავტომობილს არ გააჩნია."}, "1F": {"label": "ძრავის მუშაობის დრო", "technical": "ბოლო დაქოქვის შემდეგ", "unit": "წმ", "category": "engine", "priority": 4, "meaning": "აჩვენებს, თუ რამდენი წამი გავიდა ძრავის ბოლო დაქოქვიდან."}, "2C": {"label": "EGR პოზიცია (ბრძანებული)", "technical": "ბრძანებული", "unit": "%", "category": "engine", "priority": 5, "meaning": "გიჩვენებთ, თუ რამდენად ითხოვს კომპიუტერი გამონაბოლქვის რეცირკულაციის სარქველის გახსნას."}, "2D": {"label": "EGR ცდომილება", "unit": "%", "category": "engine", "priority": 6, "decimals": 1, "meaning": "პროცენტული სხვაობა კომპიუტერის მიერ მოთხოვნილ და სარქველის რეალურ პოზიციას შორის."}, "4C": {"label": "დროსელი (ბრძანებული)", "unit": "%", "category": "engine", "priority": 7, "meaning": "დროსელის სარქველის პოზიცია, რომელსაც ავტომობილის კომპიუტერი ითხოვს."}, "45": {"label": "დროსელი (ფარდობითი)", "unit": "%", "category": "engine", "priority": 8, "meaning": "დროსელის პოზიცია მისსავე დამახსოვრებულ მინიმალურ ნიშნულთან მიმართებაში."}, "49": {"label": "გაზის სატერფული D", "unit": "%", "category": "engine", "priority": 9, "meaning": "გაზის პედლის პირველი სენსორის მონაცემი."}, "4A": {"label": "გაზის სატერფული E", "unit": "%", "category": "engine", "priority": 10, "meaning": "გაზის პედლის მეორე სენსორის მონაცემი, რომელიც უსაფრთხოებისთვის არის დუბლირებული."}, "46": {"label": "გარემოს ტემპერატურა", "unit": "°C", "category": "context", "priority": 1, "meaning": "გარე ჰაერის ტემპერატურა ავტომობილის სენსორის მონაცემებზე დაყრდნობით."}, "33": {"label": "ატმოსფერული წნევა", "unit": "kPa", "category": "context", "priority": 2, "meaning": "გარემოს ატმოსფერული წნევა. ზღვის დონეზე დაახლოებით 101 kPa ფიქსირდება, ხოლო მთაში ეს მაჩვენებელი იკლებს."}, "21": {"label": "მანძილი ჩეკის ნათურით", "technical": "გავლილი კილომეტრები ნათურა ანთებული", "unit": "კმ", "category": "context", "priority": 3, "meaning": "რამდენი კილომეტრი გაიარა ავტომობილმა Check Engine ნათურა ანთებულ მდგომარეობაში. ნული ნიშნავს, რომ ნათურა არ ანთებულა. ეს არ არის იგივე, რაც კოდების წაშლის შემდეგ გავლილი მანძილი."}, "31": {"label": "მანძილი კოდების წაშლის შემდეგ", "technical": "გავლილი კილომეტრები", "unit": "კმ", "category": "context", "priority": 3, "meaning": "რამდენი კილომეტრი გაიარა ავტომობილმა მას შემდეგ, რაც შეცდომების მეხსიერება ბოლოს გასუფთავდა. მცირე მაჩვენებელი ნიშნავს, რომ კოდები ცოტა ხნის წინ წაიშალა."}};
    var CATS = [
        { key: 'primary', ka: 'მთავარი' },
        { key: 'fuel', ka: 'ჰაერი და საწვავი' },
        { key: 'engine', ka: 'ძრავის მუშაობა' },
        { key: 'context', ka: 'გარემო და ისტორია' }
    ];
    var AB = function (b) { return b[0] * 256 + b[1]; };
    var F = {
        '0C': [2, function (b) { return Math.round(AB(b) / 4); }],
        '0D': [1, function (b) { return b[0]; }],
        '05': [1, function (b) { return b[0] - 40; }],
        '42': [2, function (b) { return AB(b) / 1000; }],
        '04': [1, function (b) { return b[0] * 100 / 255; }],
        '06': [1, function (b) { return (b[0] - 128) * 100 / 128; }],
        '07': [1, function (b) { return (b[0] - 128) * 100 / 128; }],
        '11': [1, function (b) { return b[0] * 100 / 255; }],
        '0F': [1, function (b) { return b[0] - 40; }],
        '77': [2, function (b) { return b[1] - 40; }],
        '10': [2, function (b) { return AB(b) / 100; }],
        '0B': [1, function (b) { return b[0]; }],
        '2F': [1, function (b) { return b[0] * 100 / 255; }],
        '0E': [1, function (b) { return b[0] / 2 - 64; }],
        '43': [2, function (b) { return AB(b) * 100 / 255; }],
        '5C': [1, function (b) { return b[0] - 40; }],
        '1F': [2, function (b) { return AB(b); }],
        '2C': [1, function (b) { return b[0] * 100 / 255; }],
        '2D': [1, function (b) { return b[0] * 100 / 128 - 100; }],
        '4C': [1, function (b) { return b[0] * 100 / 255; }],
        '45': [1, function (b) { return b[0] * 100 / 255; }],
        '49': [1, function (b) { return b[0] * 100 / 255; }],
        '4A': [1, function (b) { return b[0] * 100 / 255; }],
        '46': [1, function (b) { return b[0] - 40; }],
        '33': [1, function (b) { return b[0]; }],
        '21': [2, function (b) { return AB(b); }],
        '31': [2, function (b) { return AB(b); }]
    };
    // ჩვენი არსებული liveData გასაღებები → PID (ეს უკვე იკითხება readLiveData / readExtraLiveData-ში)
    var MIRROR = { rpm: '0C', speed: '0D', coolant: '05', throttle: '11', engineLoad: '04', intakeTemp: '0F', runtime: '1F', fuelLevel: '2F', maf: '10' };

    // შეფასება (Obede-ს ზღვრები)
    function interpret(pid, v, rpm) {
        var ok = { status: 'ok', label: 'ნორმაშია' };
        if (v === null || v === undefined || isNaN(v)) return null;
        switch (pid) {
            case '05': return v >= 110 ? { status: 'attention', label: 'ტემპერატურა მაღალია' } : (v < 80 ? { status: 'warming', label: 'ძრავი ხურდება' } : ok);
            case '42':
                if (!(rpm > 400)) return v < 12 ? { status: 'attention', label: 'აკუმულატორი დამჯდარია' } : (v < 12.4 ? { status: 'low', label: 'მუხტი დაბალია' } : { status: 'ok', label: 'აკუმულატორი დატენილია' });
                return v > 14.9 ? { status: 'attention', label: 'ძაბვა მაღალია' } : (v < 13.2 ? { status: 'low', label: 'მუხტი სუსტია' } : { status: 'ok', label: 'იმუხტება' });
            case '06': case '07': var a = Math.abs(v); return a >= 25 ? { status: 'attention', label: 'ფიქსირდება დიდი გადახრა' } : (a >= 10 ? { status: 'attention', label: 'ფიქსირდება გადახრა' } : ok);
            case '2F': return v <= 10 ? { status: 'low', label: 'საწვავის დონე დაბალია' } : null;
            case '21': return v > 0 ? { status: 'attention', label: 'ნათურა ანთებული იყო' } : { status: 'ok', label: 'ნათურა არ ანთებულა' };
        }
        return null;
    }

    function fmt(pid, v) {
        if (v === null || v === undefined || isNaN(v)) return '—';
        var m = META[pid] || {}, d = m.decimals !== undefined ? m.decimals : (pid === '42' ? 1 : 0);
        if (pid === '10') d = 1;
        return (d ? Number(v).toFixed(d) : String(Math.round(v))) + (m.unit ? ' ' + m.unit : '');
    }

    async function readPid(app, pid) {
        var cmd = '01' + pid, raw = await app.sendELMCommand(cmd, 2000);
        var clean = app.cleanELMResponse(raw, cmd);
        for (var i = 0; i < clean.lines.length; i++) {
            if (app.isErrorResponse(clean.lines[i])) continue;
            var hex = clean.lines[i].replace(/[^0-9A-Fa-f]/g, '').toUpperCase(), k = hex.indexOf('41' + pid);
            if (k < 0) continue;
            var data = hex.substring(k + 4), b = [];
            for (var j = 0; j + 2 <= data.length; j += 2) b.push(parseInt(data.substr(j, 2), 16));
            return b;
        }
        return null;
    }

    var state = { socket: null, supported: null, queue: [], pos: 0 };

    async function loadSupported(app) {
        var set = {};
        var bases = ['00', '20', '40', '60'];
        for (var i = 0; i < bases.length; i++) {
            var b = await readPid(app, bases[i]);
            if (!b || b.length < 4) break;
            var base = parseInt(bases[i], 16);
            for (var bit = 0; bit < 32; bit++) if (b[bit >> 3] & (0x80 >> (bit & 7))) set[(base + bit + 1).toString(16).toUpperCase().padStart(2, '0')] = true;
            if (!set[(base + 32).toString(16).toUpperCase().padStart(2, '0')]) break;
        }
        return set;
    }

    function push(store, pid, v) {
        var now = Date.now(), h = store.hist[pid] || [];
        h.push([now, v]);
        while (h.length && now - h[0][0] > 60000) h.shift();   // ბოლო 60 წამი
        store.hist[pid] = h;
        store.vals[pid] = v;
        store.rev++;
    }

    window.OCTANE_LIVE = {
        cats: CATS, meta: META, fmt: fmt, interpret: interpret,

        // ყოველ readExtraLiveData-ზე: არსებული მნიშვნელობების ასახვა + 4 დამატებითი PID
        tick: async function (app) {
            var store = window.Alpine && Alpine.store('live');
            if (!store) return;
            Object.keys(MIRROR).forEach(function (k) {
                var v = app.liveData ? app.liveData[k] : null;
                if (v !== null && v !== undefined && v !== '' && !isNaN(v)) push(store, MIRROR[k], Number(v));
            });
            if (state.socket !== app.socketId) { state = { socket: app.socketId, supported: null, queue: [], pos: 0 }; store.supported = null; }
            if (!state.supported) {
                state.supported = await loadSupported(app);
                var mirrored = {}; Object.keys(MIRROR).forEach(function (k) { mirrored[MIRROR[k]] = 1; });
                state.queue = Object.keys(F).filter(function (p) { return !mirrored[p] && (state.supported[p] || !Object.keys(state.supported).length); });
                store.supported = Object.assign({}, state.supported);
            }
            for (var n = 0; n < 4 && state.queue.length; n++) {
                if (!app.liveStreaming) return;
                var pid = state.queue[state.pos % state.queue.length];
                state.pos++;
                var b = await readPid(app, pid);
                if (b && b.length >= F[pid][0]) push(store, pid, F[pid][1](b));
            }
        }
    };

    document.addEventListener('alpine:init', function () {
        window.Alpine.store('live', {
            vals: {}, hist: {}, rev: 0, supported: null, open: '',
            get groups() {
                this.rev;
                var vals = this.vals, sup = this.supported;
                return CATS.map(function (c) {
                    var items = Object.keys(META).filter(function (p) { return META[p].category === c.key && p !== '0C' && (vals[p] !== undefined || (sup && sup[p])); })
                        .sort(function (a, b) { return (META[a].priority || 9) - (META[b].priority || 9); });
                    return { key: c.key, ka: c.ka, items: items };
                }).filter(function (g) { return g.items.length; });
            },
            label: function (p) { return (META[p] || {}).label || p; },
            value: function (p) { this.rev; return fmt(p, this.vals[p]); },
            status: function (p) { this.rev; return interpret(p, this.vals[p], this.vals['0C']); },
            meta: function (p) { return META[p] || {}; },
            // 60 წამის გრაფიკი (SVG points)
            spark: function (p) {
                this.rev;
                var h = this.hist[p] || [];
                if (h.length < 2) return '';
                var t0 = Date.now() - 60000, min = Infinity, max = -Infinity;
                h.forEach(function (x) { min = Math.min(min, x[1]); max = Math.max(max, x[1]); });
                if (max === min) { max += 1; min -= 1; }
                return h.map(function (x) { return (((x[0] - t0) / 60000) * 100).toFixed(1) + ',' + (46 - ((x[1] - min) / (max - min)) * 42).toFixed(1); }).join(' ');
            },
            reset: function () { this.vals = {}; this.hist = {}; this.rev++; }
        });
    });
})();
