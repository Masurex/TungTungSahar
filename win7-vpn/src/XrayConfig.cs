using System.Collections.Generic;
using System.Linq;
using static SaharVPN.Json;

namespace SaharVPN
{
    /// <summary>Builds an Xray-core JSON config for one server.</summary>
    static class XrayConfig
    {
        public const int SocksPort = 10808;
        public const int HttpPort = 10809;

        public static string Build(ServerProfile p, bool russiaDirect)
        {
            var rules = new List<object>
            {
                Obj("type", "field", "ip", Arr("geoip:private"), "outboundTag", "direct"),
                Obj("type", "field", "domain", Arr("domain:localhost"), "outboundTag", "direct"),
            };
            if (russiaDirect)
            {
                // Russian sites (banks, Gosuslugi, etc.) go directly, everything else through the VPN.
                rules.Add(Obj("type", "field",
                    "domain", Arr("domain:ru", "domain:xn--p1ai", "domain:su", "domain:xn--d1acj3b",
                                  "domain:yandex.net", "domain:yastatic.net", "domain:vk.com", "domain:userapi.com",
                                  "domain:mail.ru", "domain:sberbank.com"),
                    "outboundTag", "direct"));
                rules.Add(Obj("type", "field", "ip", Arr("geoip:ru"), "outboundTag", "direct"));
            }

            var sniffing = Obj("enabled", true, "destOverride", Arr("http", "tls"), "routeOnly", true);

            var config = Obj(
                "log", Obj("loglevel", "warning"),
                "inbounds", Arr(
                    Obj("tag", "socks", "listen", "127.0.0.1", "port", SocksPort, "protocol", "socks",
                        "settings", Obj("udp", true, "auth", "noauth"), "sniffing", sniffing),
                    Obj("tag", "http", "listen", "127.0.0.1", "port", HttpPort, "protocol", "http",
                        "sniffing", sniffing)
                ),
                "outbounds", Arr(
                    BuildOutbound(p),
                    Obj("tag", "direct", "protocol", "freedom"),
                    Obj("tag", "block", "protocol", "blackhole")
                ),
                // AsIs: IP rules only apply to literal IPs, so no local DNS lookups (no DNS leaks / ISP poisoning).
                "routing", Obj("domainStrategy", "AsIs", "rules", rules)
            );
            return Serialize(config);
        }

        static Dictionary<string, object> BuildOutbound(ServerProfile p)
        {
            switch (p.Protocol)
            {
                case "vless":
                    {
                        var user = Obj("id", p.UserId, "encryption", p.Get("encryption", "none"), "flow", p.Get("flow"));
                        return Obj("tag", "proxy", "protocol", "vless",
                            "settings", Obj("vnext", Arr(Obj("address", p.Address, "port", p.Port, "users", Arr(user)))),
                            "streamSettings", BuildStream(p));
                    }
                case "trojan":
                    return Obj("tag", "proxy", "protocol", "trojan",
                        "settings", Obj("servers", Arr(Obj("address", p.Address, "port", p.Port, "password", p.UserId))),
                        "streamSettings", BuildStream(p));
                default: // shadowsocks
                    return Obj("tag", "proxy", "protocol", "shadowsocks",
                        "settings", Obj("servers", Arr(Obj("address", p.Address, "port", p.Port,
                            "method", p.Method, "password", p.UserId))));
            }
        }

        static Dictionary<string, object> BuildStream(ServerProfile p)
        {
            string net = p.Network;
            string sec = p.Security;
            string host = p.Get("host");
            string path = p.Get("path", "/");
            var s = Obj("network", net, "security", sec);

            switch (net)
            {
                case "ws":
                    s["wsSettings"] = Obj("path", path, "host", host);
                    break;
                case "grpc":
                    s["grpcSettings"] = Obj("serviceName", p.Get("serviceName"), "authority", p.Get("authority"),
                        "multiMode", p.Get("mode") == "multi");
                    break;
                case "httpupgrade":
                    s["httpupgradeSettings"] = Obj("path", path, "host", host);
                    break;
                case "xhttp":
                    {
                        var x = Obj("path", path, "host", host, "mode", p.Get("mode", "auto"));
                        string extra = p.Get("extra");
                        if (extra.StartsWith("{")) x["extra"] = new JsonRaw(extra);
                        s["xhttpSettings"] = x;
                        break;
                    }
                case "tcp":
                    if (p.Get("headerType") == "http")
                    {
                        s["tcpSettings"] = Obj("header", Obj("type", "http",
                            "request", Obj("path", Arr(path),
                                "headers", host.Length > 0 ? Obj("Host", Arr(host)) : null)));
                    }
                    break;
            }

            string sni = p.Get("sni", p.Get("peer", host));
            string fp = p.Get("fp");
            if (sec == "tls")
            {
                var alpn = p.Get("alpn").Split(',').Select(a => a.Trim()).Where(a => a.Length > 0).Cast<object>().ToList();
                s["tlsSettings"] = Obj("serverName", sni, "fingerprint", fp,
                    "alpn", alpn.Count > 0 ? alpn : null,
                    "allowInsecure", p.Get("allowInsecure") == "1" || p.Get("insecure") == "1");
            }
            else if (sec == "reality")
            {
                s["realitySettings"] = Obj("serverName", sni, "fingerprint", fp.Length > 0 ? fp : "chrome",
                    "publicKey", p.Get("pbk"), "shortId", p.Get("sid"), "spiderX", p.Get("spx"),
                    "mldsa65Verify", p.Get("pqv"));
            }
            return s;
        }
    }
}
