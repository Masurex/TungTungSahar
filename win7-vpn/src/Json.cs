using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace SaharVPN
{
    /// <summary>Pre-serialized JSON fragment that is written as-is.</summary>
    sealed class JsonRaw
    {
        public readonly string Text;
        public JsonRaw(string text) { Text = text; }
    }

    /// <summary>Minimal JSON writer (.NET 4.5 has no built-in one that is pleasant to use).</summary>
    static class Json
    {
        /// <summary>Builds an object from key/value pairs, skipping null and empty-string values.</summary>
        public static Dictionary<string, object> Obj(params object[] kv)
        {
            var d = new Dictionary<string, object>();
            for (int i = 0; i + 1 < kv.Length; i += 2)
            {
                var v = kv[i + 1];
                if (v == null) continue;
                if (v is string s && s.Length == 0) continue;
                d[(string)kv[i]] = v;
            }
            return d;
        }

        public static List<object> Arr(params object[] items) => new List<object>(items);

        public static string Serialize(object o)
        {
            var sb = new StringBuilder();
            Write(sb, o, 0);
            return sb.ToString();
        }

        static void Write(StringBuilder sb, object o, int indent)
        {
            switch (o)
            {
                case null: sb.Append("null"); return;
                case JsonRaw raw: sb.Append(raw.Text); return;
                case string s: WriteString(sb, s); return;
                case bool b: sb.Append(b ? "true" : "false"); return;
                case int i: sb.Append(i.ToString(CultureInfo.InvariantCulture)); return;
                case long l: sb.Append(l.ToString(CultureInfo.InvariantCulture)); return;
                case double dd: sb.Append(dd.ToString("R", CultureInfo.InvariantCulture)); return;
                case IDictionary<string, object> dict:
                    {
                        if (dict.Count == 0) { sb.Append("{}"); return; }
                        sb.Append("{\n");
                        int n = 0;
                        foreach (var kv in dict)
                        {
                            sb.Append(' ', (indent + 1) * 2);
                            WriteString(sb, kv.Key);
                            sb.Append(": ");
                            Write(sb, kv.Value, indent + 1);
                            if (++n < dict.Count) sb.Append(',');
                            sb.Append('\n');
                        }
                        sb.Append(' ', indent * 2).Append('}');
                        return;
                    }
                case IEnumerable list:
                    {
                        var items = new List<object>();
                        foreach (var x in list) items.Add(x);
                        if (items.Count == 0) { sb.Append("[]"); return; }
                        sb.Append("[\n");
                        for (int k = 0; k < items.Count; k++)
                        {
                            sb.Append(' ', (indent + 1) * 2);
                            Write(sb, items[k], indent + 1);
                            if (k < items.Count - 1) sb.Append(',');
                            sb.Append('\n');
                        }
                        sb.Append(' ', indent * 2).Append(']');
                        return;
                    }
                default:
                    WriteString(sb, o.ToString());
                    return;
            }
        }

        static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }
}
