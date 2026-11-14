using System;
using System.Collections.Generic;
using System.Text;

namespace SaharVPN
{
    /// <summary>One server, parsed from a share link (vless://, trojan://, ss://).</summary>
    sealed class ServerProfile
    {
        public string Protocol;   // vless | trojan | shadowsocks
        public string Address;
        public int Port;
        public string Remark;
        public string UserId;     // VLESS uuid / Trojan password / SS password
        public string Method;     // Shadowsocks cipher
        public Dictionary<string, string> Query = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public string Link;       // original link, used as the profile's identity
        public bool FromSubscription;

        public string Get(string key, string def = "")
        {
            return Query.TryGetValue(key, out var v) && !string.IsNullOrEmpty(v) ? v : def;
        }

        public string Network
        {
            get
            {
                var t = Get("type", "tcp").ToLowerInvariant();
                if (t == "raw") t = "tcp";
                if (t == "splithttp") t = "xhttp";
                return t;
            }
        }

        public string Security => Get("security", Protocol == "trojan" ? "tls" : "none").ToLowerInvariant();

        public string DisplayName => string.IsNullOrEmpty(Remark) ? Address + ":" + Port : Remark;

        public string TypeLabel
        {
            get
            {
                string p = Protocol == "shadowsocks" ? "SS" : Protocol.ToUpperInvariant();
                if (Protocol == "shadowsocks") return p;
                string sec = Security == "reality" ? "Reality" : Security == "tls" ? "TLS" : "";
                return p + " " + Network + (sec.Length > 0 ? " · " + sec : "");
            }
        }

        // ------------------------------------------------------------------ parsing

        /// <summary>Parses a share link. Returns null if the link is not supported.</summary>
        public static ServerProfile TryParse(string link)
        {
            if (string.IsNullOrWhiteSpace(link)) return null;
            link = link.Trim();
            try
            {
                if (link.StartsWith("vless://", StringComparison.OrdinalIgnoreCase)) return ParseStandard(link, "vless");
                if (link.StartsWith("trojan://", StringComparison.OrdinalIgnoreCase)) return ParseStandard(link, "trojan");
                if (link.StartsWith("ss://", StringComparison.OrdinalIgnoreCase)) return ParseShadowsocks(link);
            }
            catch
            {
                // malformed link
            }
            return null;
        }

        /// <summary>scheme://user@host:port?query#remark</summary>
        static ServerProfile ParseStandard(string link, string protocol)
        {
            var p = new ServerProfile { Protocol = protocol, Link = link };
            string rest = link.Substring(link.IndexOf("://", StringComparison.Ordinal) + 3);

            int hash = rest.IndexOf('#');
            if (hash >= 0)
            {
                p.Remark = Unescape(rest.Substring(hash + 1));
                rest = rest.Substring(0, hash);
            }

            int q = rest.IndexOf('?');
            if (q >= 0)
            {
                ParseQuery(rest.Substring(q + 1), p.Query);
                rest = rest.Substring(0, q);
            }
            rest = rest.TrimEnd('/');

            int at = rest.LastIndexOf('@');
            if (at < 0) return null;
            p.UserId = Unescape(rest.Substring(0, at));
            if (!ParseHostPort(rest.Substring(at + 1), out p.Address, out p.Port)) return null;
            if (string.IsNullOrEmpty(p.UserId)) return null;
            return p;
        }

        /// <summary>ss://base64(method:password)@host:port#remark  or  ss://base64(method:password@host:port)#remark</summary>
        static ServerProfile ParseShadowsocks(string link)
        {
            var p = new ServerProfile { Protocol = "shadowsocks", Link = link };
            string rest = link.Substring(5);

            int hash = rest.IndexOf('#');
            if (hash >= 0)
            {
                p.Remark = Unescape(rest.Substring(hash + 1));
                rest = rest.Substring(0, hash);
            }
            int q = rest.IndexOf('?');
            if (q >= 0)
            {
                ParseQuery(rest.Substring(q + 1), p.Query);
                rest = rest.Substring(0, q);
            }
            rest = rest.TrimEnd('/');

            string userInfo, hostPort;
            int at = rest.LastIndexOf('@');
            if (at >= 0)
            {
                userInfo = Unescape(rest.Substring(0, at));
                if (!userInfo.Contains(":")) userInfo = DecodeBase64(userInfo);
                hostPort = rest.Substring(at + 1);
            }
            else
            {
                string decoded = DecodeBase64(rest);
                at = decoded.LastIndexOf('@');
                if (at < 0) return null;
                userInfo = decoded.Substring(0, at);
                hostPort = decoded.Substring(at + 1);
            }

            int colon = userInfo.IndexOf(':');
            if (colon <= 0) return null;
            p.Method = userInfo.Substring(0, colon);
            p.UserId = userInfo.Substring(colon + 1);
            if (!ParseHostPort(hostPort, out p.Address, out p.Port)) return null;
            return p;
        }

        static bool ParseHostPort(string s, out string host, out int port)
        {
            host = null; port = 0;
            int colon = s.LastIndexOf(':');
            if (colon <= 0) return false;
            host = s.Substring(0, colon).Trim('[', ']');
            return int.TryParse(s.Substring(colon + 1), out port) && port > 0 && port < 65536 && host.Length > 0;
        }

        static void ParseQuery(string query, Dictionary<string, string> into)
        {
            foreach (var part in query.Split('&'))
            {
                if (part.Length == 0) continue;
                int eq = part.IndexOf('=');
                if (eq < 0) into[Unescape(part)] = "";
                else into[Unescape(part.Substring(0, eq))] = Unescape(part.Substring(eq + 1));
            }
        }

        static string Unescape(string s)
        {
            try { return Uri.UnescapeDataString(s); } catch { return s; }
        }

        /// <summary>Decodes standard or URL-safe base64, with or without padding. Returns "" on failure.</summary>
        public static string DecodeBase64(string s)
        {
            try
            {
                s = s.Trim().Replace('-', '+').Replace('_', '/').Replace("\r", "").Replace("\n", "").Replace(" ", "");
                switch (s.Length % 4)
                {
                    case 2: s += "=="; break;
                    case 3: s += "="; break;
                }
                return Encoding.UTF8.GetString(Convert.FromBase64String(s));
            }
            catch
            {
                return "";
            }
        }
    }
}
