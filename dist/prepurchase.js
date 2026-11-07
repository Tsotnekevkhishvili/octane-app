/* ═══════════ 🔎 მანქანის შეძენამდე შემოწმება (წყარო: Obede - ავტორის საკუთარი აპი) ═══════════
   ამოწმებს, ხომ არ წაშალეს ხარვეზები ახლახან: კომპიუტერის მთვლელები (SAE J1979, სერვისი 01),
   აქტიური/დაგროვილი/მუდმივი კოდები (03/07/0A) და სისტემების თვითშემოწმება (PID 01 - readiness).
   ზღვრები Obede-დან: მანძილი <20/<100 კმ, დრო <60 წთ/<24 სთ, გათბობის ციკლი <3/<10, თვითშემოწმება >50% დაუსრულებელი.
   გამოყენება: $store.pp.start(obdApp) - obdApp-ის sendELMCommand / cleanELMResponse / parseDtcResponse */
(function () {
    var T = {
        distanceVeryLowKm: 20, distanceLowKm: 100,
        timeVeryLowMin: 60, timeLowMin: 1440,
        warmupsVeryLow: 3, warmupsLow: 10,
        readinessMostlyIncompleteFraction: 0.5
    };
    var STEPS = ['ხარვეზების ძებნა', 'კომპიუტერის მეხსიერების ანალიზი', 'ჩეკის ისტორიის გადამოწმება', 'სისტემის თვითშემოწმება', 'ანგარიშის მომზადება'];
    var CONCERN_TITLE = { low: 'საეჭვო ნიშნები არ გამოვლინდა', medium: 'საყურადღებო დეტალები', high: 'აღმოჩენილია საეჭვო კვალი', none: 'შემოწმება ვერ დასრულდა' };
    var CONCERN_SUMMARY = {
        low: 'კომპიუტერის მეხსიერებაში კოდების წაშლის ან ხარვეზების დამალვის საეჭვო ნიშნები არ ფიქსირდება.',
        medium: 'სისტემაში ფიქსირდება დეტალები, რომელთა გადამოწმებაც შეძენამდე აუცილებელია.',
        high: 'კომპიუტერის მონაცემები აჩვენებს, რომ ავტომობილში ხარვეზების კოდები სულ ახლახან წაშალეს.',
        none: 'სისტემამ ვერ მიიღო საკმარისი მონაცემები ავტომობილიდან სრული დასკვნის გასაკეთებლად.'
    };
    var MEANING = {
        low: 'კომპიუტერის ჩანაწერებში საეჭვო არაფერი ჩანს. ეს ავტომობილის ტექნიკურ გამართულობას არ ადასტურებს, მხოლოდ იმას, რომ კოდები ახლახან არ წაშლილა.',
        medium: 'ხარვეზები შესაძლოა ახლახან წაშალეს. ავტომობილის შეძენამდე დამატებითი გადამოწმება ღირს.',
        high: 'ხარვეზები შესაძლოა ახლახან წაშალეს. რადგან სისტემის თვითშემოწმება ჯერ არ დასრულებულა, კოდები შეიძლება მალევე ხელახლა აინთოს.',
        none: ''
    };
    var RECOMMEND = {
        'take-a-test-drive-and-rescan': 'გაატარეთ მანქანა და ხელახლა დაასკანირეთ',
        'ask-for-service-history': 'გამოკითხეთ გამყიდველი ჩატარებულ სერვისზე',
        'have-a-mechanic-inspect': 'საფუძვლიანად შეამოწმებინეთ ხელოსანს',
        'do-not-rely-on-the-dashboard-light': 'არ ენდოთ მხოლოდ ჩამქრალ ჩეკის ნათურას',
        'rescan-after-some-driving': 'გავლის შემდეგ კიდევ ერთხელ დაასკანირეთ'
    };
    // PID 01: ბენზინი / დიზელი - ბაიტი C/D-ს ბიტები
    var MON_SPARK = ['catalyst', 'heated-catalyst', 'evap', 'secondary-air', 'ac-refrigerant', 'oxygen-sensor', 'oxygen-sensor-heater', 'egr'];
    var MON_DIESEL = ['nmhc-catalyst', 'nox-aftertreatment', null, 'boost-pressure', null, 'exhaust-gas-sensor', 'pm-filter', 'egr-vvt'];
    var MON_CONT = ['misfire', 'fuel-system', 'components'];
    var MON_NAME = {
        'misfire': 'ცილინდრებში ანთება', 'fuel-system': 'საწვავის მიწოდება', 'components': 'ძირითადი კომპონენტები', 'catalyst': 'კატალიზატორი',
        'heated-catalyst': 'გამაცხელებელი კატალიზატორი', 'evap': 'საწვავის ორთქლი (EVAP)', 'secondary-air': 'მეორადი ჰაერის ტუმბო',
        'ac-refrigerant': 'კონდიციონერის ფრეონი', 'oxygen-sensor': 'ჟანგბადის სენსორი (O2)', 'oxygen-sensor-heater': 'ჟანგბადის სენსორის გამათბობელი',
        'egr': 'EGR სარქველი', 'nmhc-catalyst': 'NMHC კატალიზატორი', 'nox-aftertreatment': 'NOx გამონაბოლქვი', 'boost-pressure': 'ტურბინის წნევა',
        'exhaust-gas-sensor': 'გამონაბოლქვის სენსორი', 'pm-filter': 'ნაწილაკების ფილტრი (DPF)', 'egr-vvt': 'EGR და VVT სისტემები'
    };
    var INFO = {
        how: { t: 'როგორ მუშაობს ეს შემოწმება?', p: ['როდესაც ხარვეზებს შლიან, ავტომობილს დრო და გარკვეული მანძილი სჭირდება სისტემების თავიდან შესამოწმებლად.', 'თუ ხარვეზები არ ჩანს, მაგრამ სისტემის შემოწმება ჯერ არ დასრულებულა, ეს ნიშნავს, რომ კოდები შეიძლება მალევე ხელახლა აინთოს.', 'აპი კითხულობს კომპიუტერის მთვლელებს და ამოწმებს, რამდენი ხანია გასული ბოლო წაშლიდან. ეს შემოწმება ვერ ამბობს, ვინ და რატომ წაშალა კოდები.'] },
        clear: { t: 'კოდების წაშლიდან გასული დრო', p: ['კოდების წაშლის შემდეგ კომპიუტერი ითვლის, რამდენი კილომეტრი გაიარა ავტომობილმა და რამდენი დრო გავიდა.', 'თუ ეს რიცხვები ძალიან მცირეა, კოდები სულ ახლახან წაიშალა.'] },
        mil: { t: 'ჩეკის ისტორია', p: ['კომპიუტერი ითვლის, რამდენი კილომეტრი გაიარა ავტომობილმა ანთებული ჩეკის ნათურით.', 'ეს მთვლელიც ნულდება კოდების წაშლისას, ამიტომ ნულზე მეტი რიცხვი ბოლო წაშლის შემდეგ დაგროვდა.'] },
        permanent: { t: 'მუდმივი ხარვეზი', p: ['მუდმივი კოდი კომპიუტერში რჩება მანამ, სანამ ავტომობილი პრობლემის გამოსწორებას თავად არ დაადასტურებს.', 'მისი უბრალოდ წაშლა შეუძლებელია.'] }
    };

    function fmtMin(m) {
        if (m < 60) return m + ' წთ';
        if (m < 1440) return Math.floor(m / 60) + ' სთ' + (m % 60 ? ' ' + (m % 60) + ' წთ' : '');
        var d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
        return d + ' დღე' + (h ? ' ' + h + ' სთ' : '');
    }

    // სერვისი 01: პასუხის ბაიტები (41 PID ...) ან null
    async function readPid(app, pid, timeout) {
        var cmd = '01' + pid;
        var raw = await app.sendELMCommand(cmd, timeout || 3000);
        if (app.elmTimedOut && app.elmResync) await app.elmResync();
        var clean = app.cleanELMResponse(raw, cmd);
        for (var i = 0; i < clean.lines.length; i++) {
            var l = clean.lines[i];
            if (app.isErrorResponse(l)) continue;
            var hex = l.replace(/\s+/g, '').toUpperCase().replace(/^[0-9A-F]:/, '');
            var k = hex.indexOf('41' + pid.toUpperCase());
            if (k < 0) continue;
            var data = hex.substring(k + 4), b = [];
            for (var j = 0; j + 2 <= data.length; j += 2) b.push(parseInt(data.substr(j, 2), 16));
            if (b.length) return b;
        }
        return null;
    }
    // მხარდაჭერილი PID-ები (0100 / 0120 / 0140 ბიტური რუკა)
    async function supported(app) {
        var set = {};
        var bases = ['00', '20', '40'];
        for (var i = 0; i < bases.length; i++) {
            var b = await readPid(app, bases[i]);
            if (!b || b.length < 4) break;
            var base = parseInt(bases[i], 16);
            for (var bit = 0; bit < 32; bit++) {
                if (b[bit >> 3] & (0x80 >> (bit & 7))) set[(base + bit + 1).toString(16).toUpperCase().padStart(2, '0')] = true;
            }
            if (!set[(base + 32).toString(16).toUpperCase().padStart(2, '0')]) break;   // შემდეგი რუკა აღარ არის
        }
        return set;
    }

    document.addEventListener('alpine:init', function () {
        window.Alpine.store('pp', {
            open: false,
            state: 'idle',      // idle | run | done | error
            step: 0,
            steps: STEPS,
            info: '',
            r: null,
            infoText: INFO,
            monName: MON_NAME,
            recText: RECOMMEND,

            show: function () { this.open = true; if (this.state !== 'run') this.state = 'idle'; },
            close: function () { if (this.state !== 'run') this.open = false; },

            start: async function (app) {
                if (!app || !app.connected || this.state === 'run') return;
                if (app.liveStreaming && app.toggleLiveStream) app.toggleLiveStream();
                this.open = true; this.state = 'run'; this.step = 0; this.r = null; this.info = '';
                var self = this;
                var tick = function (n) { self.step = n; };
                try {
                    var r = { stored: [], pending: [], permanent: [], counters: {}, readiness: null, diesel: false, milOn: false, available: 0 };
                    // 1) კოდები
                    tick(0);
                    r.stored = app.parseDtcResponse(await app.sendELMCommand('03', 6000), '03', '43');
                    r.pending = app.parseDtcResponse(await app.sendELMCommand('07', 6000), '07', '47');
                    r.permanent = app.parseDtcResponse(await app.sendELMCommand('0A', 6000), '0A', '4A');
                    // 2) მთვლელები
                    tick(1);
                    var sup = await supported(app);
                    var counter = async function (key, pid, two) {
                        if (Object.keys(sup).length && !sup[pid]) { r.counters[key] = { state: 'unsupported' }; return; }
                        var b = await readPid(app, pid);
                        if (!b || b.length < (two ? 2 : 1)) { r.counters[key] = { state: 'unavailable' }; return; }
                        r.counters[key] = { state: 'available', value: two ? b[0] * 256 + b[1] : b[0] };
                        r.available++;
                    };
                    await counter('distanceSinceClear', '31', true);
                    await counter('timeSinceClear', '4E', true);
                    await counter('warmupsSinceClear', '30', false);
                    // 3) ჩეკის ისტორია
                    tick(2);
                    await counter('distanceWithMil', '21', true);
                    await counter('timeWithMil', '4D', true);
                    // 4) თვითშემოწმება (PID 01)
                    tick(3);
                    var s = await readPid(app, '01');
                    if (s && s.length >= 4) {
                        r.milOn = !!(s[0] & 0x80);
                        r.diesel = !!(s[1] & 0x08);
                        var list = [];
                        for (var i = 0; i < 3; i++) if (s[1] & (1 << i)) list.push({ key: MON_CONT[i], done: !(s[1] & (0x10 << i)) });
                        var names = r.diesel ? MON_DIESEL : MON_SPARK;
                        for (var k = 0; k < 8; k++) if (names[k] && (s[2] & (1 << k))) list.push({ key: names[k], done: !(s[3] & (1 << k)) });
                        r.readiness = list;
                    }
                    // 5) დასკვნა
                    tick(4);
                    self.r = self.evaluate(r);
                    self.state = 'done';
                    try { localStorage.setItem('octane_pp_last', JSON.stringify({ at: Date.now(), concern: self.r.concern })); } catch (e) {}
                } catch (e) {
                    self.state = 'error';
                }
            },

            evaluate: function (r) {
                var F = [], high = false, medium = false;
                var add = function (lvl, text, info) { F.push({ lvl: lvl, text: text, info: info || '' }); if (lvl === 'high') high = true; if (lvl === 'medium') medium = true; };
                var c = r.counters, v = function (k) { return c[k] && c[k].state === 'available' ? c[k].value : null; };

                if (r.permanent.length && !r.stored.length) add('high', 'აღმოჩენილია ' + r.permanent.length + ' მუდმივი ხარვეზის კოდი, თუმცა აქტიური კოდები წაშლილია.', 'permanent');
                else if (r.permanent.length) add('medium', 'აღმოჩენილია ' + r.permanent.length + ' მუდმივი ხარვეზის კოდი.', 'permanent');
                if (r.stored.length) add('medium', 'სისტემაში ამჟამად ფიქსირდება ' + r.stored.length + ' აქტიური შეცდომა.');

                var d = v('distanceSinceClear');
                if (d !== null && d < T.distanceVeryLowKm) add('high', 'კოდების წაშლიდან გავლილია მხოლოდ ' + d + ' კმ.', 'clear');
                else if (d !== null && d < T.distanceLowKm) add('medium', 'კოდების წაშლიდან გავლილია ' + d + ' კმ.', 'clear');
                var t = v('timeSinceClear');
                if (t !== null && t < T.timeVeryLowMin) add('high', 'კოდების წაშლიდან გასულია მხოლოდ ' + fmtMin(t) + '.', 'clear');
                else if (t !== null && t < T.timeLowMin) add('medium', 'კოდების წაშლიდან გასულია ' + fmtMin(t) + '.', 'clear');
                var w = v('warmupsSinceClear');
                if (w !== null && w < T.warmupsVeryLow) add('high', 'კოდების წაშლის შემდეგ დაფიქსირებულია მხოლოდ ' + w + ' გათბობის ციკლი.', 'clear');
                else if (w !== null && w < T.warmupsLow) add('medium', 'კოდების წაშლის შემდეგ დაფიქსირებულია ' + w + ' გათბობის ციკლი.', 'clear');
                var mk = v('distanceWithMil'), mt = v('timeWithMil');
                if (mk) add('medium', 'ავტომობილმა ანთებული ჩეკით გაიარა ' + mk + ' კმ.', 'mil');
                else if (mt) add('medium', 'ჩეკი ანთებული იყო ' + fmtMin(mt) + '.', 'mil');

                var incomplete = 0, total = 0;
                if (r.readiness) {
                    total = r.readiness.length;
                    incomplete = r.readiness.filter(function (x) { return !x.done; }).length;
                    if (total && incomplete / total > T.readinessMostlyIncompleteFraction) add('medium', total + ' სისტემიდან უმეტესობის (' + incomplete + ') შემოწმება ჯერ არ დასრულებულა.');
                    else if (incomplete) add('low', total + ' სისტემიდან ' + incomplete + '-ის შემოწმება ჯერ არ დასრულებულა.');
                }

                var concern = high ? 'high' : (medium ? 'medium' : ((r.available || r.readiness) ? 'low' : 'none'));
                var rec = concern === 'high' ? ['take-a-test-drive-and-rescan', 'have-a-mechanic-inspect', 'do-not-rely-on-the-dashboard-light']
                        : concern === 'medium' ? ['ask-for-service-history', 'rescan-after-some-driving', 'have-a-mechanic-inspect']
                        : concern === 'low' ? ['ask-for-service-history'] : ['rescan-after-some-driving'];

                var cnt = function (k, unit) {
                    var x = c[k];
                    if (!x) return '—';
                    if (x.state === 'unsupported') return 'მიუწვდომელია';
                    if (x.state !== 'available') return 'ვერ წაიკითხა';
                    return unit === 'min' ? fmtMin(x.value) : x.value + (unit ? ' ' + unit : '');
                };
                return {
                    concern: concern,
                    title: CONCERN_TITLE[concern], summary: CONCERN_SUMMARY[concern], meaning: MEANING[concern],
                    findings: F, recommendations: rec,
                    rows: [
                        { k: 'კოდების წაშლიდან გავლილი მანძილი', v: cnt('distanceSinceClear', 'კმ'), info: 'clear' },
                        { k: 'კოდების წაშლიდან გასული დრო', v: cnt('timeSinceClear', 'min'), info: 'clear' },
                        { k: 'გათბობის ციკლები', v: cnt('warmupsSinceClear', '') },
                        { k: 'გავლილი ანთებული ჩეკით', v: cnt('distanceWithMil', 'კმ'), info: 'mil' },
                        { k: 'ჩეკი ანთებული იყო', v: cnt('timeWithMil', 'min'), info: 'mil' }
                    ],
                    readiness: r.readiness, readyDone: total - incomplete, readyTotal: total,
                    stored: r.stored, pending: r.pending, permanent: r.permanent, milOn: r.milOn
                };
            }
        });
    });
})();
