using System;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace SaharVPN
{
    /// <summary>Windows system proxy (the one IE, Chrome, Edge, Yandex and Firefox-by-default use). HKCU only, no admin needed.</summary>
    static class SystemProxy
    {
        const string KeyPath = @"Software\Microsoft\Windows\CurrentVersion\Internet Settings";
        const string Bypass = "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;" +
                              "172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>";

        public static string OurServer => "127.0.0.1:" + XrayConfig.HttpPort;

        public sealed class State
        {
            public int Enable;
            public string Server = "";
            public string Override = "";
        }

        public static State Read()
        {
            var st = new State();
            using (var k = Registry.CurrentUser.OpenSubKey(KeyPath))
            {
                if (k == null) return st;
                st.Enable = Convert.ToInt32(k.GetValue("ProxyEnable", 0));
                st.Server = k.GetValue("ProxyServer", "") as string ?? "";
                st.Override = k.GetValue("ProxyOverride", "") as string ?? "";
            }
            return st;
        }

        public static bool IsOurs()
        {
            var st = Read();
            return st.Enable == 1 && st.Server == OurServer;
        }

        public static void EnableOurs()
        {
            Write(new State { Enable = 1, Server = OurServer, Override = Bypass });
        }

        public static void Write(State st)
        {
            using (var k = Registry.CurrentUser.CreateSubKey(KeyPath))
            {
                k.SetValue("ProxyEnable", st.Enable, RegistryValueKind.DWord);
                if (string.IsNullOrEmpty(st.Server)) k.DeleteValue("ProxyServer", false);
                else k.SetValue("ProxyServer", st.Server);
                if (string.IsNullOrEmpty(st.Override)) k.DeleteValue("ProxyOverride", false);
                else k.SetValue("ProxyOverride", st.Override);
            }
            Notify();
        }

        [DllImport("wininet.dll", SetLastError = true)]
        static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);

        static void Notify()
        {
            const int INTERNET_OPTION_SETTINGS_CHANGED = 39;
            const int INTERNET_OPTION_REFRESH = 37;
            InternetSetOption(IntPtr.Zero, INTERNET_OPTION_SETTINGS_CHANGED, IntPtr.Zero, 0);
            InternetSetOption(IntPtr.Zero, INTERNET_OPTION_REFRESH, IntPtr.Zero, 0);
        }
    }
}
