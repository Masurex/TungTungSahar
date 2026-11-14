using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading.Tasks;

namespace SaharVPN
{
    /// <summary>What the user pasted: share links, a subscription URL, or nothing useful.</summary>
    sealed class ImportResult
    {
        public List<string> Links = new List<string>();
        public string SubscriptionUrl;
        public string Error;
    }

    static class Net
    {
        static Net()
        {
            // Windows 7 + .NET 4.5 default to SSL3/TLS1.0; subscription servers need TLS 1.2.
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls;
        }

        /// <summary>Understands vless/trojan/ss links, https subscription URLs and the "add" deep links of other clients.</summary>
        public static ImportResult ParseImport(string text)
        {
            var r = new ImportResult();
            text = (text ?? "").Trim();
            if (text.Length == 0) { r.Error = "Буфер обмена пуст. Скопируйте ключ или ссылку подписки и попробуйте снова."; return r; }

            // happ://add/https://..., v2raytun://import/https://..., hiddify://import/https://...
            foreach (var prefix in new[] { "happ://add/", "v2raytun://import/", "hiddify://import/", "v2rayng://install-sub?url=", "streisand://import/" })
            {
                if (text.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    text = Uri.UnescapeDataString(text.Substring(prefix.Length)).Trim();
                    break;
                }
            }

            if (text.StartsWith("happ://crypt", StringComparison.OrdinalIgnoreCase))
            {
                r.Error = "Это зашифрованная ссылка Happ (happ://crypt…). Её может открыть только сам Happ.\n\n" +
                          "Попросите в боте Gemera VPN обычную ссылку подписки (https://…) или ключ vless://… " +
                          "(часто есть кнопка «Другие приложения», «v2rayN» или «Скопировать ключ»).";
                return r;
            }

            if ((text.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || text.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                && !text.Contains("\n"))
            {
                r.SubscriptionUrl = text;
                return r;
            }

            r.Links = ExtractLinks(text);
            if (r.Links.Count == 0)
                r.Error = "Не удалось распознать ключ. Поддерживаются ссылки vless://, trojan://, ss:// и ссылки подписки https://…";
            return r;
        }

        /// <summary>Plain list of links or base64-encoded list (both are common subscription formats).</summary>
        public static List<string> ExtractLinks(string text)
        {
            text = (text ?? "").Trim();
            if (!text.Contains("://"))
            {
                var decoded = ServerProfile.DecodeBase64(text);
                if (decoded.Contains("://")) text = decoded;
            }
            return text.Split(new[] { '\r', '\n', ' ' }, StringSplitOptions.RemoveEmptyEntries)
                       .Select(l => l.Trim())
                       .Where(l => ServerProfile.TryParse(l) != null)
                       .Distinct()
                       .ToList();
        }

        /// <summary>Downloads a subscription. Tries directly first, then through the running VPN (if any).</summary>
        public static async Task<string> DownloadSubscription(string url, bool viaProxyFallback)
        {
            try
            {
                return await Task.Run(() => Download(url, null));
            }
            catch (Exception direct)
            {
                if (!viaProxyFallback) throw;
                try
                {
                    return await Task.Run(() => Download(url, new WebProxy("127.0.0.1", XrayConfig.HttpPort)));
                }
                catch
                {
                    throw direct;
                }
            }
        }

        static string Download(string url, IWebProxy proxy)
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.UserAgent = "v2rayN/7.10.0"; // panels (Marzban, Remnawave, 3x-ui) return plain links for this client
            req.Timeout = 20000;
            req.ReadWriteTimeout = 20000;
            req.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            req.Proxy = proxy ?? WebRequest.GetSystemWebProxy();
            if (proxy == null && SystemProxy.IsOurs()) req.Proxy = null; // don't loop through ourselves when testing "direct"
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var rs = resp.GetResponseStream())
            using (var sr = new StreamReader(rs, Encoding.UTF8))
            {
                return sr.ReadToEnd();
            }
        }

        /// <summary>TCP connect time to the server in ms, or -1 on failure/timeout.</summary>
        public static Task<int> TcpPing(string host, int port, int timeoutMs = 3000)
        {
            return Task.Run(() =>
            {
                try
                {
                    using (var c = new TcpClient())
                    {
                        var sw = Stopwatch.StartNew();
                        var ar = c.BeginConnect(host, port, null, null);
                        if (!ar.AsyncWaitHandle.WaitOne(timeoutMs)) return -1;
                        c.EndConnect(ar);
                        return (int)sw.ElapsedMilliseconds;
                    }
                }
                catch
                {
                    return -1;
                }
            });
        }

        /// <summary>Real round trip through the tunnel: HTTP 204 from Google via the local proxy. ms or -1.</summary>
        public static Task<int> ProxyDelay(int port = XrayConfig.HttpPort, int attempts = 2, int timeoutMs = 8000)
        {
            return Task.Run(() =>
            {
                int best = -1;
                for (int attempt = 0; attempt < attempts; attempt++) // first request includes the handshake
                {
                    try
                    {
                        var req = (HttpWebRequest)WebRequest.Create("http://www.gstatic.com/generate_204");
                        req.Proxy = new WebProxy("127.0.0.1", port);
                        req.Timeout = timeoutMs;
                        req.ReadWriteTimeout = timeoutMs;
                        req.KeepAlive = false;
                        var sw = Stopwatch.StartNew();
                        using (var resp = (HttpWebResponse)req.GetResponse()) { }
                        int ms = (int)sw.ElapsedMilliseconds;
                        if (best < 0 || ms < best) best = ms;
                    }
                    catch
                    {
                    }
                }
                return best;
            });
        }
    }
}
