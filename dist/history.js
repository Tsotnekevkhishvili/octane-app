/* ═══════════ 🕘 სკანირების ისტორია (წყარო: Obede - ავტორის საკუთარი აპი) ═══════════
   ყოველი სკანირება და ჩეკის ჩაქრობა ინახება ტელეფონში (მაქს. 100 ჩანაწერი), მანქანის მიხედვით.
   შედარება წინა სკანირებასთან: ახალი / კვლავ ფიქსირდება / აღარ ფიქსირდება. */
(function () {
    var KEY = 'octane_history', MAX = 100;
    var MONTHS = ['იან', 'თებ', 'მარ', 'აპრ', 'მაი', 'ივნ', 'ივლ', 'აგვ', 'სექ', 'ოქტ', 'ნოე', 'დეკ'];

    function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { return []; } }
    function save(a) { try { localStorage.setItem(KEY, JSON.stringify(a.slice(-MAX))); } catch (e) {} }
    function carKey() {
        try { var c = Alpine.store('car'); return [c.brand, c.model, c.year].join('|') || 'default'; } catch (e) { return 'default'; }
    }
    function carTitle() { try { return Alpine.store('car').title; } catch (e) { return ''; } }
    function dayStart(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

    function dayLabel(t) {
        var today = dayStart(Date.now()), d = dayStart(t), diff = Math.round((today - d) / 86400000);
        if (diff === 0) return 'დღეს';
        if (diff === 1) return 'გუშინ';
        var dt = new Date(t);
        return dt.getDate() + ' ' + MONTHS[dt.getMonth()] + (dt.getFullYear() !== new Date().getFullYear() ? ' ' + dt.getFullYear() : '');
    }
    function timeOfDay(t) { var d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

    window.OCTANE_HISTORY = {
        add: function (kind, codes) {
            var a = load();
            a.push({ at: Date.now(), kind: kind, car: carKey(), title: carTitle(), codes: (codes || []).slice(0, 60) });
            save(a);
            try { Alpine.store('hist').rev++; } catch (e) {}
        }
    };

    document.addEventListener('alpine:init', function () {
        window.Alpine.store('hist', {
            open: false, rev: 0,
            get items() {
                this.rev;
                var key = carKey(), all = load().filter(function (x) { return x.car === key; });
                // შედარება წინა სკანირებასთან (იმავე მანქანაზე)
                var prev = null, out = [];
                all.forEach(function (x) {
                    var row = { at: x.at, kind: x.kind, codes: x.codes, added: [], same: [], gone: [], first: x.kind === 'scan' && !prev };
                    if (x.kind === 'scan' && prev) {
                        row.added = x.codes.filter(function (c) { return prev.indexOf(c) < 0; });
                        row.same = x.codes.filter(function (c) { return prev.indexOf(c) >= 0; });
                        row.gone = prev.filter(function (c) { return x.codes.indexOf(c) < 0; });
                    }
                    if (x.kind === 'scan') prev = x.codes;
                    if (x.kind === 'clear') prev = [];
                    out.push(row);
                });
                return out.reverse();
            },
            get days() {
                var groups = [], cur = null;
                this.items.forEach(function (r) {
                    var k = dayStart(r.at);
                    if (!cur || cur.key !== k) { cur = { key: k, label: dayLabel(r.at), rows: [] }; groups.push(cur); }
                    cur.rows.push(r);
                });
                return groups;
            },
            get last() { var i = this.items; return i.length ? i.find(function (r) { return r.kind === 'scan'; }) || null : null; },
            time: timeOfDay,
            dayLabel: dayLabel,
            title: function (r) {
                if (r.kind === 'clear') return 'შეცდომები გასუფთავდა';
                return r.codes.length ? r.codes.length + ' პრობლემა' : 'შეცდომები არ მოიძებნა';
            },
            change: function (r) {
                if (r.kind !== 'scan' || r.first) return '';
                var p = [];
                if (r.added.length) p.push(r.added.length + ' ახალი');
                if (r.gone.length) p.push(r.gone.length + ' აღარ ფიქსირდება');
                return p.length ? p.join(' · ') : 'ცვლილება არ არის';
            },
            clearAll: function () {
                var key = carKey();
                save(load().filter(function (x) { return x.car !== key; }));
                this.rev++;
            }
        });
    });
})();
