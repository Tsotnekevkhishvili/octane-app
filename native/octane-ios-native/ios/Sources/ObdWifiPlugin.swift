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
        let prefix = call.getString("prefix", "WiFi_OBD")
        ObdWifiPlugin.reachable(host: "192.168.0.10", port: 35000, timeout: 1.2) { ok in
            if ok { call.resolve(["connected": true, "already": true]); return }
            self.join(prefix: prefix, fresh: false, call: call)
        }
    }

    /// სკანერი ხელმისაწვდომი გახდა? (WiFi-ზე გადასვლას iPhone-ს რამდენიმე წამი სჭირდება)
    static func waitReachable(tries: Int, _ done: @escaping (Bool) -> Void) {
        reachable(host: "192.168.0.10", port: 35000, timeout: 1.0) { ok in
            if ok || tries <= 1 { done(ok); return }
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.7) { waitReachable(tries: tries - 1, done) }
        }
    }

    /// მიერთება. fresh = true: ძველი (შენახული) პარამეტრი იშლება და iPhone თავიდან აჩვენებს Join ფანჯარას.
    /// შენახული პარამეტრით iPhone ჩუმად ცდილობს მიერთებას და ზოგჯერ ვერ ახერხებს - მაშინ ერთხელ თავიდან ვცდით.
    private func join(prefix: String, fresh: Bool, call: CAPPluginCall) {
        let apply: () -> Void = {
            let cfg = NEHotspotConfiguration(ssidPrefix: prefix)
            cfg.joinOnce = false
            NEHotspotConfigurationManager.shared.apply(cfg) { error in
                if let e = error as NSError?, e.code != NEHotspotConfigurationError.alreadyAssociated.rawValue {
                    if e.code == NEHotspotConfigurationError.userDenied.rawValue { call.reject("DENIED"); return }
                    if !fresh { self.join(prefix: prefix, fresh: true, call: call); return }
                    call.reject("UNAVAILABLE: \(e.localizedDescription)")
                    return
                }
                self.joinedPrefix = prefix
                ObdWifiPlugin.waitReachable(tries: 12) { ok in
                    if ok { call.resolve(["connected": true]); return }
                    if !fresh { self.join(prefix: prefix, fresh: true, call: call); return }
                    call.resolve(["connected": false])
                }
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
