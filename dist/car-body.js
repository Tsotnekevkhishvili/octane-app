/* ═══════════ 🚙 ძარის ტიპი: ბრენდი + მოდელი → 3D მოდელის ტიპი ═══════════
   ტიპები ემთხვევა 3D ნაკრებს (img/3d/<type>.glb). მომხმარებელს შეუძლია ხელით შეცვლა. */
(function () {
    var TYPES = [
        { key: 'sedan', ka: 'სედანი' },
        { key: 'hatchback', ka: 'ჰეჩბეკი' },
        { key: 'wagon', ka: 'უნივერსალი' },
        { key: 'compact', ka: 'კომპაქტი' },
        { key: 'suv', ka: 'ჯიპი' },
        { key: 'offroad', ka: 'მაღალი გამავლობის' },
        { key: 'minivan', ka: 'მინივენი' },
        { key: 'pickup', ka: 'პიკაპი' },
        { key: 'coupe', ka: 'კუპე' },
        { key: 'sport', ka: 'სპორტული' }
    ];

    // სიტყვები მოდელის სახელში → ტიპი (თანმიმდევრობას აქვს მნიშვნელობა)
    var RULES = [
        ['offroad', /wrangler|defender|g-class|\bg ?\d{3}|land cruiser(?! prado)|prado|4runner|pajero(?! mini)|montero(?! sport)|patrol|jimny|bronco(?! sport)|fj cruiser|niva|hunter|uaz|samurai|\blx\b|\blx ?\d|\bgx\b|\bgx ?\d|hummer|h1\b|h2\b|gladiator|xterra|terrano|terracan|safari/],
        ['pickup', /hilux|tacoma|tundra|f-?1[05]0|f-?250|f-?350|ranger|silverado|sierra|\bram\b|1500|2500|frontier|navara|titan|colorado|canyon|l200|triton|amarok|d-?max|ridgeline|maverick|santa cruz|wingle|poer|bt-50|mighty max|pick-?up|t100|cybertruck|r1t|x-class|baja|brat/],
        ['minivan', /sienna|odyssey|sedona|carnival|pacifica|caravan|alphard|vellfire|estima|previa|noah|voxy|serena|stepwgn|elysion|freed|sienta|touran|sharan|galaxy|s-max|zafira|scenic|espace|picasso|berlingo|kangoo|rifter|partner|transit|tourneo|sprinter|vito|viano|v-class|multivan|transporter|caravelle|starex|staria|h-1|\bquest\b|routan|town & country|\bmpv\b|delica|biante|premacy|mazda5|exiga|grandis|trajet|carens|orlando|alhambra|lodgy|jogger|largus|gazelle|sobol|hiace|nv200|\bnv\b|metris|id\. ?buzz|entourage|caddy|doblo|ducato|combo|vivaro|trafic|jumpy|expert|traveller|citan|daily|bukhanka|damas|rodius|xpander|wish|isis|prius v|prius alpha/],
        ['sport', /911|918|corvette|gt-?r|nsx|\br8\b|amg gt|\bi8\b|f-type|viper|huracan|aventador|urus|gallardo|murcielago|revuelto|lfa|supra|570s|720s|750s|artura|senna|\bsf90|roma|portofino|f8|488|458|812|296|purosangue|dbs|db11|db12|vantage|continental gt|evora|emira|elise|exige|mc20|carrera|cayman|boxster|spyder|z4|slk|slc|sl-class|\bsl\b|mx-5|miata|s2000|\bbrz\b|\b86\b|gr86|370z|350z|\bz\b|nissan z|rx-7|rx-8|type r/],
        ['coupe', /coupe|mustang|camaro|challenger|charger|genesis coupe|tiburon|veloster|scirocco|eclipse(?! cross)|celica|prelude|cr-z|rc\b|\brc ?\d|lc\b|\blc ?\d|clk|cle|\bcl-|\bcls|4 series|\bm4\b|6 series|8 series|\bm8\b|\btt\b|\ba5\b|\brs5|\bs5\b|q8|scion tc|fr-s|del sol|mr2|solara|\bxk|e-type|gt86/],
        ['wagon', /wagon|estate|touring|avant|allroad|alltrack|outback|levorg|\bv[4-9]0\b|fielder|airwave|shuttle|wingroad|combi|sportwagen|\bsw\b|variant|\bcc\b|jetta wagon|stanza wagon|legacy wagon|prius alpha|caldina|corolla rumion/],
        ['compact', /matiz|spark|picanto|morning|\bi10\b|\bup\b|aygo|twingo|smart|fortwo|\b500\b|panda|\bc1\b|\b10[78]\b|alto|celerio|wagon r|n-box|tanto|move|copen|pleo|stella|\bist\b|passo|\bbb\b|cube|\bmarch\b|micra|mirage|space star|i-miev|\bka\b|tico|\bspring\b|scion iq|\biq\b|fox|agila|adam|mii|citigo|\bc2\b|pajero mini|soul|\bmini\b|cooper|e-golf|leaf|zoe|\bi3\b/],
        ['hatchback', /hatch|elantra gt|i30|prius|aqua|fit|jazz|yaris|vitz|golf|polo|\bi20\b|\bi30\b|getz|focus|fiesta|mazda2|mazda3|demio|axela|swift|\bnote\b|tiida|versa note|clio|\b20[678]\b|\b30[78]\b|corsa|astra|\ba1\b|\ba2\b|\ba3\b|1 series|a-class|\bb-class|fabia|ibiza|leon|punto|bravo|tipo|ceed|\brio\b|accent|sandero|\bc3\b|\bc4\b|ractis|auris|corolla im|matrix|insight|grace|ct\b|\bct ?\d|impreza|crosstrek|xv|\bsx4|baleno|ignis|splash|colt|lancer sportback|i-?pace|ioniq(?! [5-9])|bolt|sonic|aveo|kalina|granta|vesta|priora|210[49]|211[2-5]|\b30\b|\bbz\b|clarity|echo|tercel|starlet|scion x[ad]|scion im|venga|bayon|stonic|juke|kicks|leaf|zoe|mx-30/],
        ['suv', /suv|cross|\bx[1-7]\b|\bx[1-7] m|\bxm\b|\bq[2-8]\b|gl[abcesk]|\bml\b|m-class|eq[bc]|rav4|cr-v|hr-v|zr-v|vezel|passport|pilot|tucson|santa fe|palisade|kona|creta|venue|ix35|ix55|veracruz|sportage|sorento|telluride|seltos|sonet|mohave|niro|ev9|ev6|\bev3|cx-|tribute|forester|ascent|tribeca|outlander|asx|eclipse cross|rvr|endeavor|montero sport|pajero sport|x-trail|rogue|qashqai|dualis|murano|pathfinder|armada|ariya|kicks|qx|fx|ex35|tiguan|touareg|atlas|t-roc|t-cross|taos|id\.[46]|kuga|escape|edge|explorer|expedition|ecosport|puma|bronco sport|equinox|trax|captiva|blazer|traverse|tahoe|suburban|trailblazer|tracker|terrain|acadia|yukon|escalade|xt[4-6]|enclave|encore|envision|envista|navigator|aviator|corsair|nautilus|mkx|mkc|mkt|grand cherokee|cherokee|compass|renegade|commander|patriot|liberty|durango|journey|nitro|highlander|sequoia|venza|c-hr|corolla cross|harrier|rush|raize|fortuner|yaris cross|crown signia|grand highlander|\bnx\b|\bnx ?\d|\brx\b|\brx ?\d|\bux\b|\btx\b|\brz\b|range rover|discovery|freelander|evoque|velar|e-pace|f-pace|xc[4-9]0|ex[39]0|c40|macan|cayenne|bentayga|cullinan|levante|grecale|stelvio|tonale|urus|purosangue|countryman|paceman|duster|koleos|kadjar|captur|arkana|antara|frontera|mokka|crossland|grandland|kodiaq|karoq|kamiq|enyaq|yeti|ateca|arona|tarraco|formentor|tavascan|2008|3008|4008|5008|c5 aircross|c3 aircross|tiggo|coolray|atlas|monjaro|okavango|tugella|haval|h6|h9|jolion|dargo|f7|cs[3-8]5|uni-[ktv]|js4|\bt[68]\b|korando|kyron|rexton|actyon|tivoli|torres|musso|\bvitara|escudo|grand vitara|s-cross|xl7|x-90|sidekick|patriot|vitara|nexo|model x|model y|r1s|mach-e|solterra|bz4x|lyriq|hummer ev|\bl[6-9]\b|g6|g9|\b00[179]\b|zeekr x|x50|x70|niva travel|xray|terios|rocky|q4 e-tron|e-tron|ionic 5|ioniq [5-9]/],
    ];
    var BRAND_DEFAULT = {
        'Jeep': 'suv', 'Land Rover': 'suv', 'Ram': 'pickup', 'Ferrari': 'sport', 'Lamborghini': 'sport', 'McLaren': 'sport',
        'Aston Martin': 'sport', 'Lotus': 'sport', 'Hummer': 'offroad', 'UAZ': 'offroad', 'Rivian': 'suv', 'Haval': 'suv',
        'Great Wall': 'pickup', 'GAZ': 'minivan', 'Iveco': 'minivan', 'Smart': 'compact', 'MINI': 'compact', 'Li Auto': 'suv', 'Zeekr': 'suv'
    };

    function guess(brand, model) {
        var m = (' ' + String(model || '') + ' ').toLowerCase();
        for (var i = 0; i < RULES.length; i++) if (RULES[i][1].test(m)) return RULES[i][0];
        return BRAND_DEFAULT[brand] || 'sedan';
    }

    // ─────────── შავი ხატულები (გვერდიდან, მარჯვნივ მიმართული) ───────────
    // b - ძარა, w - ფანჯრები, wh - საბურავები [x, ...], r - საბურავის რადიუსი, y - საბურავის ცენტრი
    var ICONS = {
        sedan:     { b: 'M6 33V27Q6 23 12 22L32 19 44 10Q47 8 51 8H74Q79 8 82 11L92 19 108 21Q114 22 114 27V33Q114 35 112 35H8Q6 35 6 33Z', w: 'M47 18 52 11H62V18ZM65 11H74Q77 11 79 13L85 18H65Z', wh: [28, 92], r: 7, y: 34 },
        hatchback: { b: 'M10 33V14Q10 9 16 8H60Q65 8 69 11L82 19 104 22Q110 23 110 28V33Q110 35 108 35H12Q10 35 10 33Z', w: 'M16 18V12H38V18ZM41 12H60Q63 12 66 14L72 18H41Z', wh: [27, 90], r: 7, y: 34 },
        wagon:     { b: 'M6 33V13Q6 9 11 8H70Q75 8 79 11L90 19 108 21Q114 22 114 27V33Q114 35 112 35H8Q6 35 6 33Z', w: 'M11 18V12H34V18ZM37 12H54V18H37ZM57 12H70Q73 12 76 14L81 18H57Z', wh: [26, 94], r: 7, y: 34 },
        compact:   { b: 'M18 33V12Q18 6 25 6H62Q68 6 72 11L82 20Q90 22 90 28V33Q90 35 88 35H20Q18 35 18 33Z', w: 'M24 18V11H44V18ZM47 11H62Q65 11 68 14L72 18H47Z', wh: [33, 76], r: 6.5, y: 34 },
        suv:       { b: 'M6 33V12Q6 6 13 6H76Q81 6 84 10L92 18 108 20Q114 21 114 27V33Q114 36 111 36H9Q6 36 6 33Z', w: 'M12 17V10H40V17ZM43 10H62V17H43ZM65 10H76Q79 10 81 12L86 17H65Z', wh: [28, 92], r: 8, y: 35 },
        offroad:   { b: 'M8 33V8Q8 5 11 5H74L82 17H108Q113 17 113 22V33Q113 36 110 36H11Q8 36 8 33ZM3 13H8V30H3Q2 30 2 29V14Q2 13 3 13Z', w: 'M13 15V9H38V15ZM41 9H60V15H41ZM63 9H72L77 15H63Z', wh: [28, 92], r: 8.5, y: 35 },
        minivan:   { b: 'M6 33V10Q6 5 12 5H70Q78 5 84 10L100 19Q112 21 113 27V33Q113 35 111 35H8Q6 35 6 33Z', w: 'M11 15V9H32V15ZM35 9H56V15H35ZM59 9H70Q76 9 80 12L85 15H59Z', wh: [26, 94], r: 7, y: 34 },
        pickup:    { b: 'M6 33V20H50V10Q50 6 55 6H72Q77 6 80 10L88 19 108 21Q114 22 114 27V33Q114 36 111 36H9Q6 36 6 33Z', w: 'M54 17V10H66V17ZM69 10H72Q75 10 77 12L81 17H69Z', wh: [26, 94], r: 8, y: 35 },
        coupe:     { b: 'M6 33V27Q6 23 12 22L30 20 46 12Q50 10 56 10H70Q76 10 82 14L94 21 108 23Q114 24 114 28V33Q114 35 112 35H8Q6 35 6 33Z', w: 'M40 20 49 14Q52 13 56 13H64V20ZM67 13H70Q74 13 78 16L83 20H67Z', wh: [28, 94], r: 7, y: 34 },
        sport:     { b: 'M4 32V27Q4 24 9 23L36 18 50 12Q54 11 60 11H70Q77 11 84 16L100 22 112 25Q116 26 116 29V32Q116 34 114 34H6Q4 34 4 32Z', w: 'M50 17 54 14Q57 13 61 13H70Q74 13 79 16L82 18H50Z', wh: [26, 94], r: 7, y: 33 }
    };
    function svg(key) {
        var c = ICONS[key] || ICONS.sedan;
        var wheels = c.wh.map(function (x) {
            return '<circle cx="' + x + '" cy="' + c.y + '" r="' + c.r + '" fill="#141517" stroke="var(--u-bg, #EDEFF2)" stroke-width="2.6"/>' +
                   '<circle cx="' + x + '" cy="' + c.y + '" r="' + (c.r * 0.36).toFixed(2) + '" fill="#A7ADB5"/>';
        }).join('');
        return '<svg class="car-ico" viewBox="0 0 120 46" aria-hidden="true"><ellipse cx="60" cy="42.5" rx="54" ry="2.2" fill="rgba(18,20,23,.10)"/>' +
               '<path d="' + c.b + '" fill="#141517"/><path d="' + c.w + '" fill="#E3E7EC"/>' + wheels + '</svg>';
    }

    // ─────────── სავარაუდო OBD პროტოკოლი (ELM327 „AT SP“ ნომერი) - მხოლოდ პირველი ცდისთვის ───────────
    // 6 CAN 11bit/500k · 1 PWM (Ford) · 2 VPW (GM/Chrysler) · 3 ISO 9141-2 · 5 KWP2000 სწრაფი
    var FAM = {
        gm: /^(Chevrolet|GMC|Cadillac|Buick|Pontiac|Saturn|Hummer|Oldsmobile)$/,
        chrysler: /^(Chrysler|Dodge|Jeep|Ram|Plymouth)$/,
        ford: /^(Ford|Lincoln|Mercury)$/,
        asia: /^(Toyota|Lexus|Scion|Honda|Acura|Nissan|Infiniti|Mazda|Mitsubishi|Subaru|Suzuki|Daihatsu|Isuzu|Proton)$/,
        korea: /^(Hyundai|Kia|Genesis|Daewoo|SsangYong)$/
    };
    function protocol(brand, year) {
        var y = parseInt(year, 10) || 0;
        if (!brand || !y) return '';
        if (y >= 2008) return '6';
        if (FAM.gm.test(brand)) return y >= 2005 ? '6' : '2';
        if (FAM.chrysler.test(brand)) return y >= 2004 ? '5' : '2';
        if (FAM.ford.test(brand)) return y >= 2005 ? '6' : '1';
        if (FAM.asia.test(brand)) return y >= 2004 ? '5' : '3';
        if (FAM.korea.test(brand)) return y >= 2002 ? '5' : '3';
        return y >= 2001 ? '5' : '3';   // ევროპული და დანარჩენი
    }

    // აპის „მწარმოებლის კოდების“ მარკა (index.html → brandNames)
    function codeBrand(brand) {
        var map = { toyota: /^(Toyota|Lexus|Scion)$/, nissan: /^(Nissan|Infiniti)$/, hyundai: /^(Hyundai|Kia|Genesis)$/,
                    vag: /^(Volkswagen|Audi|Škoda|SEAT|Cupra|Porsche|Bentley|Lamborghini)$/, ford: /^(Ford|Lincoln|Mercury)$/,
                    gm: /^(Chevrolet|GMC|Cadillac|Buick|Pontiac|Saturn|Hummer|Daewoo)$/, honda: /^(Honda|Acura)$/, subaru: /^Subaru$/,
                    bmw: /^(BMW|MINI|Rolls-Royce)$/, mercedes: /^(Mercedes-Benz|Smart)$/, mazda: /^Mazda$/, mitsubishi: /^Mitsubishi$/, opel: /^Opel$/ };
        for (var k in map) if (map[k].test(brand || '')) return k;
        return brand ? 'other' : '';
    }

    window.OCTANE_BODY = {
        types: TYPES,
        guess: guess,
        svg: svg,
        protocol: protocol,
        codeBrand: codeBrand,
        label: function (key) { for (var i = 0; i < TYPES.length; i++) if (TYPES[i].key === key) return TYPES[i].ka; return ''; }
    };
})();
