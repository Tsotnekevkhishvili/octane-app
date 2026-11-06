import Foundation
import Capacitor
import NetworkExtension
import Network

/**
 * Octane App (iPhone) — OBD სკანერის WiFi-სთან ავტომატური მიერთება.
 * ანდროიდის ObdWifiPlugin-ის იგივე JS ინტერფეისი: isSupported(), connect({ pattern }), disconnect().
 *
 * iPhone-ზე ქსელის სახელის მხოლოდ დასაწყისით (prefix) ძებნა შეიძლება. WiFi OBD სკანერების
 * უმეტესობას „WiFi_OBD...“ ჰქვია. თუ ტელეფონი სკანერზე უკვე შეერთებულია, სისტემურ ფანჯარას არ ვაჩვენებთ.
 * საჭიროა „Hotspot Configuration“ უფლება (App ID-ზე Apple Developer-ში და App.entitlements-ში).
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
            let cfg = NEHotspotConfiguration(ssidPrefix: prefix)
            cfg.joinOnce = false
            NEHotspotConfigurationManager.shared.apply(cfg) { error in
                if let e = error as NSError?, e.code != NEHotspotConfigurationError.alreadyAssociated.rawValue {
                    call.reject("UNAVAILABLE: \(e.localizedDescription)")
                    return
                }
                self.joinedPrefix = prefix
                // iPhone-ს WiFi-ზე გადასვლას ცოტა დრო სჭირდება
                DispatchQueue.global().asyncAfter(deadline: .now() + 1.5) {
                    call.resolve(["connected": true])
                }
            }
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        // ქსელს არ ვშლით - შემდეგ ჯერზე iPhone თავად დაუკავშირდება, დამატებითი კითხვის გარეშე
        call.resolve()
    }
}
