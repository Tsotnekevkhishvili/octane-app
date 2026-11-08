import Foundation

/**
 * 🎞️ რეგისტრატორის MP4-ის შეკეთება (ხელახალი კოდირების გარეშე, წამში).
 *
 * HiDvr კამერა წამში ~25 კადრს იღებს, ფაილში კი 30-ს წერს: ყოველი მე-6 კადრი ცარიელია (0 ბაიტი).
 * VLC ცარიელ კადრს უბრალოდ ტოვებს, Apple-ის დეკოდერი (Photos, AVPlayer) კი ჩერდება -
 * ისმის მხოლოდ ხმა, გადახვევისას ჩანს პიქსელებად დაშლილი კადრები.
 *
 * აქ ფაილის სარჩევიდან (moov) ცარიელ კადრებს ვშლით და მათ ხანგრძლივობას წინა კადრს ვუმატებთ.
 * ვიდეოს მონაცემები (mdat) არ იცვლება - მხოლოდ ბოლოში მდებარე moov იწერება ხელახლა.
 */
enum OctaneMp4Fix {

    /// აბრუნებს ამოღებული ცარიელი კადრების რაოდენობას (0 - ფაილი ხელუხლებელია)
    @discardableResult
    static func fixInPlace(_ url: URL) -> Int {
        guard let fh = try? FileHandle(forUpdating: url) else { return 0 }
        defer { try? fh.close() }
        guard let fileSize = try? fh.seekToEnd() else { return 0 }

        // ზედა დონის ყუთები: mdat და moov სად არის
        var off: UInt64 = 0
        var mdatOff: UInt64? = nil
        var moovOff: UInt64 = 0
        var moovSize: UInt64 = 0
        while off + 8 <= fileSize {
            do { try fh.seek(toOffset: off) } catch { break }
            guard let hd = try? fh.read(upToCount: 16), hd.count >= 8 else { break }
            let h = [UInt8](hd)
            var size = UInt64(be32(h, 0))
            let typ = String(bytes: h[4..<8], encoding: .ascii) ?? ""
            if size == 1 {
                guard h.count >= 16 else { break }
                size = be64(h, 8)
            } else if size == 0 {
                size = fileSize - off
            }
            if size < 8 || off + size > fileSize { break }
            if typ == "mdat" && mdatOff == nil { mdatOff = off }
            if typ == "moov" { moovOff = off; moovSize = size }
            off += size
        }
        // მხოლოდ მაშინ, როცა moov ვიდეოს მონაცემების შემდეგაა (ასე წერს კამერა) - ოფსეტები არ იძვრება
        guard let md = mdatOff, moovSize > 8, moovSize < 64_000_000, moovOff > md else { return 0 }

        do { try fh.seek(toOffset: moovOff) } catch { return 0 }
        guard let md2 = try? fh.read(upToCount: Int(moovSize)), md2.count == Int(moovSize) else { return 0 }
        let moov = [UInt8](md2)
        if be32(moov, 0) == 1 { return 0 }   // 64-ბიტიანი moov - არ ხდება, არ ვეხებით

        var removed = 0
        let body = rebuild(Array(moov[8...]), &removed)
        if removed == 0 { return 0 }
        let newMoov = makeBox("moov", body)
        do {
            try fh.truncate(atOffset: moovOff)
            try fh.seek(toOffset: moovOff)
            try fh.write(contentsOf: Data(newMoov))
        } catch {
            return 0
        }
        return removed
    }

    /// მთლიანი moov ყუთი (სათაურით) მეხსიერებაში → გასწორებული moov (ცარიელი კადრების გარეშე).
    /// კამერიდან პირდაპირ ყურებისას გამოიყენება (OctaneCamVideoLoader). ვიდეოს მონაცემების ოფსეტები არ იცვლება.
    static func fixMoovBox(_ moov: [UInt8]) -> [UInt8] {
        guard moov.count > 8, be32(moov, 0) == UInt32(moov.count) else { return moov }
        var removed = 0
        let body = rebuild(Array(moov[8...]), &removed)
        return removed == 0 ? moov : makeBox("moov", body)
    }

    // ─────────── შიდა ───────────

    private static let containers: Set<String> = ["moov", "trak", "mdia", "minf", "stbl", "edts"]

    private static func be32(_ b: [UInt8], _ o: Int) -> UInt32 {
        let a = UInt32(b[o]) << 24
        let c = UInt32(b[o + 1]) << 16
        let d = UInt32(b[o + 2]) << 8
        return a | c | d | UInt32(b[o + 3])
    }

    private static func be64(_ b: [UInt8], _ o: Int) -> UInt64 {
        return (UInt64(be32(b, o)) << 32) | UInt64(be32(b, o + 4))
    }

    private static func put32(_ a: inout [UInt8], _ v: UInt32) {
        a.append(UInt8((v >> 24) & 0xff))
        a.append(UInt8((v >> 16) & 0xff))
        a.append(UInt8((v >> 8) & 0xff))
        a.append(UInt8(v & 0xff))
    }

    private static func put64(_ a: inout [UInt8], _ v: UInt64) {
        put32(&a, UInt32((v >> 32) & 0xffff_ffff))
        put32(&a, UInt32(v & 0xffff_ffff))
    }

    private static func makeBox(_ t: String, _ payload: [UInt8]) -> [UInt8] {
        var a = [UInt8]()
        a.reserveCapacity(payload.count + 8)
        put32(&a, UInt32(8 + payload.count))
        a.append(contentsOf: Array(t.utf8))
        a.append(contentsOf: payload)
        return a
    }

    private static func children(_ b: [UInt8]) -> [(String, Int, Int)] {
        var out = [(String, Int, Int)]()
        var o = 0
        while o + 8 <= b.count {
            let s = Int(be32(b, o))
            if s < 8 || o + s > b.count { break }
            let t = String(bytes: b[(o + 4)..<(o + 8)], encoding: .ascii) ?? "????"
            out.append((t, o, s))
            o += s
        }
        return out
    }

    private static func rebuild(_ b: [UInt8], _ removed: inout Int) -> [UInt8] {
        var out = [UInt8]()
        for (t, o, s) in children(b) {
            let payload = Array(b[(o + 8)..<(o + s)])
            if t == "stbl" {
                out.append(contentsOf: makeBox(t, fixStbl(payload, &removed)))
            } else if containers.contains(t) {
                out.append(contentsOf: makeBox(t, rebuild(payload, &removed)))
            } else {
                out.append(contentsOf: b[o..<(o + s)])
            }
        }
        return out
    }

    private static func fixStbl(_ b: [UInt8], _ removed: inout Int) -> [UInt8] {
        let kids = children(b)
        var get = [String: [UInt8]]()
        for (t, o, s) in kids { get[t] = Array(b[(o + 8)..<(o + s)]) }
        // B-კადრების ცხრილი (ctts) კამერას არ აქვს; თუ აქვს - არ ვეხებით
        guard let stsz = get["stsz"], let stts = get["stts"], let stsc = get["stsc"], get["ctts"] == nil else { return b }
        let isCo64 = get["co64"] != nil
        guard let co = get["co64"] ?? get["stco"] else { return b }
        guard stsz.count >= 12, be32(stsz, 4) == 0 else { return b }
        let n = Int(be32(stsz, 8))
        guard n > 0, stsz.count >= 12 + 4 * n else { return b }

        var sizes = [UInt32]()
        sizes.reserveCapacity(n)
        for i in 0..<n { sizes.append(be32(stsz, 12 + 4 * i)) }
        guard sizes.contains(0) else { return b }

        // კადრების ხანგრძლივობები
        var durs = [UInt32]()
        let ne = Int(be32(stts, 4))
        guard stts.count >= 8 + 8 * ne else { return b }
        for k in 0..<ne {
            let c = Int(be32(stts, 8 + 8 * k))
            let d = be32(stts, 12 + 8 * k)
            durs.append(contentsOf: [UInt32](repeating: d, count: c))
        }
        guard durs.count >= n else { return b }

        // თითოეული კადრის ადგილი ფაილში
        let nch = Int(be32(co, 4))
        guard co.count >= 8 + (isCo64 ? 8 : 4) * nch else { return b }
        var chunkOff = [UInt64]()
        for i in 0..<nch { chunkOff.append(isCo64 ? be64(co, 8 + 8 * i) : UInt64(be32(co, 8 + 4 * i))) }
        let nsc = Int(be32(stsc, 4))
        guard stsc.count >= 8 + 12 * nsc else { return b }
        var ents = [(Int, Int)]()
        for k in 0..<nsc { ents.append((Int(be32(stsc, 8 + 12 * k)), Int(be32(stsc, 12 + 12 * k)))) }
        var offs = [UInt64]()
        var si = 0
        for ci in 0..<nch {
            var spc = 1
            for (fc, s) in ents where ci + 1 >= fc { spc = s }
            var o = chunkOff[ci]
            for _ in 0..<spc {
                if si >= n { break }
                offs.append(o)
                o += UInt64(sizes[si])
                si += 1
            }
        }
        guard offs.count == n else { return b }

        var sync: Set<Int>? = nil
        if let st = get["stss"], st.count >= 8 {
            var s = Set<Int>()
            let cnt = Int(be32(st, 4))
            if st.count >= 8 + 4 * cnt { for i in 0..<cnt { s.insert(Int(be32(st, 8 + 4 * i))) } }
            sync = s
        }

        // ცარიელ კადრებს ვშლით, ხანგრძლივობას წინას ვუმატებთ
        var ks = [UInt32](), kd = [UInt32](), ko = [UInt64](), kss = [UInt32]()
        var rem = 0
        for i in 0..<n {
            if sizes[i] == 0 && !ks.isEmpty {
                kd[kd.count - 1] += durs[i]
                rem += 1
                continue
            }
            ks.append(sizes[i]); kd.append(durs[i]); ko.append(offs[i])
            if let sy = sync, sy.contains(i + 1) { kss.append(UInt32(ks.count)) }
        }
        if rem == 0 { return b }

        let big = (ko.max() ?? 0) > 0xFFFF_FFFF
        var nStsz = [UInt8]()
        put32(&nStsz, 0); put32(&nStsz, 0); put32(&nStsz, UInt32(ks.count))
        for x in ks { put32(&nStsz, x) }

        var runs = [(UInt32, UInt32)]()
        for d in kd {
            if let l = runs.last, l.1 == d { runs[runs.count - 1].0 += 1 } else { runs.append((1, d)) }
        }
        var nStts = [UInt8]()
        put32(&nStts, 0); put32(&nStts, UInt32(runs.count))
        for (c, d) in runs { put32(&nStts, c); put32(&nStts, d) }

        var nStsc = [UInt8]()
        for v in [0, 1, 1, 1, 1] as [UInt32] { put32(&nStsc, v) }

        var nCo = [UInt8]()
        put32(&nCo, 0); put32(&nCo, UInt32(ko.count))
        for x in ko { if big { put64(&nCo, x) } else { put32(&nCo, UInt32(x)) } }

        var nStss = [UInt8]()
        put32(&nStss, 0); put32(&nStss, UInt32(kss.count))
        for x in kss { put32(&nStss, x) }

        var out = [UInt8]()
        for (t, o, s) in kids {
            switch t {
            case "stsz": out.append(contentsOf: makeBox(t, nStsz))
            case "stts": out.append(contentsOf: makeBox(t, nStts))
            case "stsc": out.append(contentsOf: makeBox(t, nStsc))
            case "stco", "co64": out.append(contentsOf: makeBox(big ? "co64" : "stco", nCo))
            case "stss": out.append(contentsOf: makeBox(t, nStss))
            default: out.append(contentsOf: b[o..<(o + s)])
            }
        }
        removed += rem
        return out
    }
}
