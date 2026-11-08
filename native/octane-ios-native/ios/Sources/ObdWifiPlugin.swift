import Foundation
import Capacitor
import NetworkExtension
import Network

/**
 * Octane App (iPhone) - OBD სკანერის WiFi-სთან ავტომატური მიერთება.
 * ანდროიდის ObdWifiPlugin-ის იგივე JS ინტერფეისი: isSupported(), connect({ pattern }), disconnect().
 *
 * iPhone-ზე ქსელის სახელის მხოლოდ დასაწყისით (prefix) ძებნა შეიძლება. WiFi OBD სკანერების
 * უმეტესობას WiFi_OBD... ჰქვია. თუ ტელეფონი სკანერზე უკვე შეერთებულია, სისტემურ ფანჯარას არ ვაჩვენებთ.
 * საჭიროა Hotspot Configuration უფლება (App ID-ზე Apple Developer-ში და App.entitlements-ში).
 */
@objc(ObdWifiPlugin)
public class ObdWifiPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ObdWifiPlugin"
    public let jsName = "ObdWifi"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise)
    ]

    private var joinedPrefix: String?

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve(["supported": true])
    }

    /// სკანერი უკვე ხელმისაწვდომია? (ტელეფონი მის WiFi-ზეა)
    static func reachable(host: String, port: UInt16, timeout: Double, _ done: @escaping (Bool) -> Void) {
        let params = NWParameters.tcp
        params.requiredInterfaceType = .wifi
        let conn = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!, using: params)
        var finished = false
        let q = DispatchQueue(label: "ge.octane.probe")
        let end: (Bool) -> Void = { ok in
            if finished { return }
            finished = true
            conn.cancel()
            done(ok)
        }
        conn.stateUpdateHandler = { st in
            if case .ready = st { end(true) }
            if case .failed = st { end(false) }
        }
        conn.start(queue: q)
        q.asyncAfter(deadline: .now() + timeout) { end(false) }
    }

    @objc func connect(_ call: CAPPluginCall) {
        // სახელის დასაწყისი: ჯერ ბოლოს წარმატებული, მერე JS-იდან მოსული, მერე გავრცელებული ვარიანტები
        // (iPhone დიდ და პატარა ასოებს არჩევს: WIFI_OBDII და WiFi_OBDII სხვადასხვაა)
        var list: [String] = []
        if let last = UserDefaults.standard.string(forKey: "octane_obd_prefix") { list.append(last) }
        if let p = call.getString("prefix") { list.append(p) }
        list.append(contentsOf: ["WIFI_OBD", "WiFi_OBD"])
        var seen = Set<String>()
        let prefixes = list.filter { !$0.isEmpty && seen.insert($0).inserted }
        ObdWifiPlugin.reachable(host: "192.168.0.10", port: 35000, timeout: 1.2) { ok in
            if ok { call.resolve(["connected": true, "already": true]); return }
            self.tryPrefixes(prefixes, index: 0, fresh: false, call: call)
        }
    }

    /// რიგრიგობით ვცდით სახელებს; ბოლოს - პირველს თავიდან (შენახული პარამეტრის წაშლით, Join ფანჯრით)
    private func tryPrefixes(_ prefixes: [String], index: Int, fresh: Bool, call: CAPPluginCall) {
        if index >= prefixes.count {
            if fresh || prefixes.isEmpty { call.resolve(["connected": false]); return }
            tryPrefixes([prefixes[0]], index: 0, fresh: true, call: call)
            return
        }
        let prefix = prefixes[index]
        join(prefix: prefix, fresh: fresh) { result in
            switch result {
            case "ok":
                UserDefaults.standard.set(prefix, forKey: "octane_obd_prefix")
                call.resolve(["connected": true, "prefix": prefix])
            case "denied":
                call.reject("DENIED")
            default:
                self.tryPrefixes(prefixes, index: index + 1, fresh: fresh, call: call)
            }
        }
    }

    /// სკანერი ხელმისაწვდომი გახდა? (WiFi-ზე გადასვლას iPhone-ს რამდენიმე წამი სჭირდება)
    static func waitReachable(tries: Int, _ done: @escaping (Bool) -> Void) {
        reachable(host: "192.168.0.10", port: 35000, timeout: 1.0) { ok in
            if ok || tries <= 1 { done(ok); return }
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.7) { waitReachable(tries: tries - 1, done) }
        }
    }

    /// მიერთება ერთი სახელით. fresh = true: ძველი (შენახული) პარამეტრი იშლება და iPhone თავიდან აჩვენებს Join ფანჯარას.
    private func join(prefix: String, fresh: Bool, done: @escaping (String) -> Void) {
        let apply: () -> Void = {
            let cfg = NEHotspotConfiguration(ssidPrefix: prefix)
            cfg.joinOnce = false
            NEHotspotConfigurationManager.shared.apply(cfg) { error in
                if let e = error as NSError?, e.code != NEHotspotConfigurationError.alreadyAssociated.rawValue {
                    done(e.code == NEHotspotConfigurationError.userDenied.rawValue ? "denied" : "fail")
                    return
                }
                self.joinedPrefix = prefix
                ObdWifiPlugin.waitReachable(tries: 12) { ok in done(ok ? "ok" : "fail") }
            }
        }
        if !fresh { apply(); return }
        NEHotspotConfigurationManager.shared.getConfiguredSSIDs { ssids in
            for s in ssids where s.hasPrefix(prefix) {
                NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: s)
            }
            NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: prefix)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { apply() }
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        // ქსელს არ ვშლით - შემდეგ ჯერზე iPhone თავად დაუკავშირდება, დამატებითი კითხვის გარეშე
        call.resolve()
    }
}
