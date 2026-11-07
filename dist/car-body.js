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

    window.OCTANE_BODY = {
        types: TYPES,
        guess: guess,
        label: function (key) { for (var i = 0; i < TYPES.length; i++) if (TYPES[i].key === key) return TYPES[i].ka; return ''; }
    };
})();
