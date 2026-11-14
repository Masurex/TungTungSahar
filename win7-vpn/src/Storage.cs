using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace SaharVPN
{
    /// <summary>Settings and server lists. Stored next to the program (portable) or in %APPDATA% if that folder is read-only.</summary>
    sealed class Storage
    {
        public readonly string AppDir;
        public readonly string DataDir;
        readonly Dictionary<string, string> settings = new Dictionary<string, string>();

        public List<string> ManualLinks = new List<string>();
        public List<string> SubscriptionLinks = new List<string>();

        static readonly Encoding Utf8 = new UTF8Encoding(false);

        public Storage()
        {
            AppDir = AppDomain.CurrentDomain.BaseDirectory;
            DataDir = PickDataDir(AppDir);
            Load();
        }

        static string PickDataDir(string appDir)
        {
            string portable = Path.Combine(appDir, "data");
            try
            {
                Directory.CreateDirectory(portable);
                string probe = Path.Combine(portable, ".write-test");
                File.WriteAllText(probe, "ok");
                File.Delete(probe);
                return portable;
            }
            catch
            {
                string roaming = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "SaharVPN");
                Directory.CreateDirectory(roaming);
                return roaming;
            }
        }

        string SettingsFile => Path.Combine(DataDir, "settings.ini");
        string ServersFile => Path.Combine(DataDir, "servers.txt");
        string SubFile => Path.Combine(DataDir, "subscription.txt");
        public string ConfigFile => Path.Combine(DataDir, "config.json");
        public string XrayExe => Path.Combine(AppDir, "core", "xray.exe");

        void Load()
        {
            if (File.Exists(SettingsFile))
            {
                foreach (var line in File.ReadAllLines(SettingsFile, Utf8))
                {
                    int eq = line.IndexOf('=');
                    if (eq > 0) settings[line.Substring(0, eq).Trim()] = line.Substring(eq + 1);
                }
            }
            ManualLinks = ReadLinks(ServersFile);
            SubscriptionLinks = ReadLinks(SubFile);
        }

        static List<string> ReadLinks(string file)
        {
            if (!File.Exists(file)) return new List<string>();
            return File.ReadAllLines(file, Utf8).Select(l => l.Trim()).Where(l => l.Length > 0).ToList();
        }

        public void Save()
        {
            File.WriteAllLines(SettingsFile, settings.Select(kv => kv.Key + "=" + kv.Value), Utf8);
            File.WriteAllLines(ServersFile, ManualLinks, Utf8);
            File.WriteAllLines(SubFile, SubscriptionLinks, Utf8);
        }

        public string Get(string key, string def = "") => settings.TryGetValue(key, out var v) ? v : def;
        public bool GetBool(string key, bool def) => settings.TryGetValue(key, out var v) ? v == "1" : def;
        public void Set(string key, string value) => settings[key] = (value ?? "").Replace("\r", "").Replace("\n", "");
        public void SetBool(string key, bool value) => settings[key] = value ? "1" : "0";

        public List<ServerProfile> AllProfiles()
        {
            var list = new List<ServerProfile>();
            foreach (var l in ManualLinks)
            {
                var p = ServerProfile.TryParse(l);
                if (p != null) list.Add(p);
            }
            foreach (var l in SubscriptionLinks)
            {
                var p = ServerProfile.TryParse(l);
                if (p != null) { p.FromSubscription = true; list.Add(p); }
            }
            return list;
        }
    }
}
