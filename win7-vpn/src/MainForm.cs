using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace SaharVPN
{
    sealed class MainForm : Form
    {
        readonly Storage store = new Storage();
        readonly XrayRunner xray = new XrayRunner();
        readonly bool startHidden;

        List<ServerProfile> profiles = new List<ServerProfile>();
        readonly Dictionary<string, int> pings = new Dictionary<string, int>();
        bool connected, busy, exiting;
        string activeLink;

        // UI
        readonly Button btnConnect = new Button();
        readonly Label lblStatus = new Label();
        readonly Label lblInfo = new Label();
        readonly ListView list = new ListView();
        readonly TextBox log = new TextBox();
        readonly CheckBox chkRussia = new CheckBox();
        readonly CheckBox chkAutostart = new CheckBox();
        readonly CheckBox chkAutoConnect = new CheckBox();
        readonly NotifyIcon tray = new NotifyIcon();
        readonly ToolStripMenuItem trayToggle = new ToolStripMenuItem();
        readonly Icon iconOff = Icons.Make(Icons.Off), iconOn = Icons.Make(Icons.On), iconBusy = Icons.Make(Icons.Busy);

        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        static readonly Encoding Utf8 = new UTF8Encoding(false);

        public MainForm(bool autostart)
        {
            startHidden = autostart;
            BuildUi();

            xray.Log += line => Ui(() => AppendLog(line));
            xray.UnexpectedExit += code => Ui(() => OnXrayCrashed(code));

            // If the program crashed last time, the system proxy may still point at us: put it back.
            RestoreProxy();
            RefreshList();
            SetState(Icons.Off, "Отключено");

            var startup = new Timer { Interval = 300 };
            startup.Tick += async (s, e) => { startup.Stop(); startup.Dispose(); await OnStartup(); };
            startup.Start();
        }

        // ------------------------------------------------------------------ UI construction

        void BuildUi()
        {
            Text = "SaharVPN";
            Font = new Font("Segoe UI", 9f);
            Size = new Size(760, 540);
            MinimumSize = new Size(620, 420);
            StartPosition = FormStartPosition.CenterScreen;
            Icon = iconOff;

            // header: big button + status
            var header = new Panel { Dock = DockStyle.Top, Height = 80 };
            btnConnect.SetBounds(14, 14, 180, 50);
            btnConnect.FlatStyle = FlatStyle.Flat;
            btnConnect.FlatAppearance.BorderSize = 0;
            btnConnect.ForeColor = Color.White;
            btnConnect.Font = new Font("Segoe UI", 12f, FontStyle.Bold);
            btnConnect.Cursor = Cursors.Hand;
            btnConnect.Click += async (s, e) => await ToggleConnection();
            lblStatus.SetBounds(212, 14, 520, 26);
            lblStatus.Font = new Font("Segoe UI", 13f, FontStyle.Bold);
            lblStatus.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            lblInfo.SetBounds(214, 42, 520, 34);
            lblInfo.ForeColor = Color.DimGray;
            lblInfo.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            header.Controls.AddRange(new Control[] { btnConnect, lblStatus, lblInfo });

            // toolbar
            var toolbar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 36, Padding = new Padding(10, 2, 10, 0), WrapContents = false };
            toolbar.Controls.Add(MakeButton("Вставить ключ из буфера", async () => await PasteFromClipboard()));
            toolbar.Controls.Add(MakeButton("Подписка…", async () => await EditSubscription()));
            toolbar.Controls.Add(MakeButton("Обновить подписку", async () => await UpdateSubscription(true)));
            toolbar.Controls.Add(MakeButton("Пинг", async () => await PingAll()));
            toolbar.Controls.Add(MakeButton("Проверить связь", async () => await CheckConnection()));
            toolbar.Controls.Add(MakeButton("Удалить", () => { DeleteSelected(); return Task.FromResult(0); }));

            // server list
            list.Dock = DockStyle.Fill;
            list.View = View.Details;
            list.FullRowSelect = true;
            list.MultiSelect = false;
            list.HideSelection = false;
            list.Columns.Add("Сервер", 250);
            list.Columns.Add("Тип", 160);
            list.Columns.Add("Адрес", 190);
            list.Columns.Add("Пинг", 80);
            list.SelectedIndexChanged += async (s, e) => await OnSelectionChanged();
            list.DoubleClick += async (s, e) => { if (!connected) await Connect(); };

            // options
            var options = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 30, Padding = new Padding(10, 4, 10, 0), WrapContents = false };
            chkRussia.Text = "Российские сайты напрямую";
            chkRussia.AutoSize = true;
            chkRussia.Checked = store.GetBool("russiaDirect", true);
            chkRussia.CheckedChanged += async (s, e) =>
            {
                store.SetBool("russiaDirect", chkRussia.Checked); SaveStore();
                if (connected) await Connect();
            };
            chkAutostart.Text = "Запускать вместе с Windows";
            chkAutostart.AutoSize = true;
            chkAutostart.Checked = IsAutostartEnabled();
            chkAutostart.CheckedChanged += (s, e) => SetAutostart(chkAutostart.Checked);
            chkAutoConnect.Text = "Подключаться автоматически";
            chkAutoConnect.AutoSize = true;
            chkAutoConnect.Checked = store.GetBool("autoConnect", false);
            chkAutoConnect.CheckedChanged += (s, e) => { store.SetBool("autoConnect", chkAutoConnect.Checked); SaveStore(); };
            options.Controls.AddRange(new Control[] { chkRussia, chkAutostart, chkAutoConnect });

            // log
            log.Dock = DockStyle.Bottom;
            log.Height = 110;
            log.Multiline = true;
            log.ReadOnly = true;
            log.ScrollBars = ScrollBars.Vertical;
            log.Font = new Font("Consolas", 8.5f);
            log.BackColor = Color.FromArgb(248, 248, 250);

            // Docking is applied from the last-added control to the first one.
            Controls.Add(list);
            Controls.Add(options);
            Controls.Add(log);
            Controls.Add(toolbar);
            Controls.Add(header);

            // tray
            var menu = new ContextMenuStrip();
            menu.Items.Add("Открыть SaharVPN", null, (s, e) => ShowWindow());
            trayToggle.Click += async (s, e) => await ToggleConnection();
            menu.Items.Add(trayToggle);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Выход", null, (s, e) => ExitApp());
            tray.ContextMenuStrip = menu;
            tray.Icon = iconOff;
            tray.Text = "SaharVPN — отключено";
            tray.Visible = true;
            tray.DoubleClick += (s, e) => ShowWindow();

            Resize += (s, e) => { if (WindowState == FormWindowState.Minimized) Hide(); };
            FormClosing += (s, e) => Cleanup();
            SystemEvents.SessionEnding += (s, e) => Cleanup();
        }

        Button MakeButton(string text, Func<Task> action)
        {
            var b = new Button { Text = text, AutoSize = true, Height = 28, Margin = new Padding(0, 2, 6, 0) };
            b.Click += async (s, e) =>
            {
                b.Enabled = false;
                try { await action(); }
                finally { b.Enabled = true; }
            };
            return b;
        }

        protected override void SetVisibleCore(bool value)
        {
            // Started with Windows: stay in the tray, don't flash the window.
            if (startHidden && !IsHandleCreated)
            {
                CreateHandle();
                value = false;
            }
            base.SetVisibleCore(value);
        }

        void ShowWindow()
        {
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        void Ui(Action a)
        {
            if (IsDisposed || exiting) return;
            try { BeginInvoke(a); } catch (InvalidOperationException) { }
        }

        void AppendLog(string line)
        {
            if (log.TextLength > 60000) log.Text = log.Text.Substring(30000);
            log.AppendText(DateTime.Now.ToString("HH:mm:ss") + "  " + line + Environment.NewLine);
        }

        void SetState(Color color, string status, string info = null)
        {
            lblStatus.Text = status;
            lblStatus.ForeColor = color == Icons.Off ? Color.DimGray : color;
            if (info != null) lblInfo.Text = info;
            var icon = color == Icons.On ? iconOn : color == Icons.Busy ? iconBusy : iconOff;
            Icon = icon;
            tray.Icon = icon;
            tray.Text = ("SaharVPN — " + status.ToLowerInvariant());
            if (tray.Text.Length > 63) tray.Text = tray.Text.Substring(0, 63);

            btnConnect.Text = connected ? "Отключить" : "Подключить";
            btnConnect.BackColor = connected ? Color.FromArgb(200, 70, 70) : Color.FromArgb(34, 150, 85);
            btnConnect.Enabled = !busy;
            trayToggle.Text = connected ? "Отключить" : "Подключить";
            trayToggle.Enabled = !busy;
        }

        void Info(string text, MessageBoxIcon icon = MessageBoxIcon.Information)
        {
            if (!Visible) { tray.ShowBalloonTip(5000, "SaharVPN", text, icon == MessageBoxIcon.Error ? ToolTipIcon.Error : ToolTipIcon.Info); return; }
            MessageBox.Show(this, text, "SaharVPN", MessageBoxButtons.OK, icon);
        }

        void SaveStore()
        {
            try { store.Save(); }
            catch (Exception ex) { AppendLog("Не удалось сохранить настройки: " + ex.Message); }
        }

        // ------------------------------------------------------------------ server list

        void RefreshList()
        {
            profiles = store.AllProfiles();
            string selected = store.Get("selected");
            list.BeginUpdate();
            list.Items.Clear();
            foreach (var p in profiles)
            {
                var item = new ListViewItem(new[] { p.DisplayName, p.TypeLabel, p.Address + ":" + p.Port, PingText(p) }) { Tag = p };
                if (p.Link == activeLink && connected) item.Font = new Font(list.Font, FontStyle.Bold);
                if (p.FromSubscription) item.ToolTipText = "Из подписки";
                list.Items.Add(item);
            }
            list.EndUpdate();

            var sel = list.Items.Cast<ListViewItem>().FirstOrDefault(i => ((ServerProfile)i.Tag).Link == selected)
                      ?? (list.Items.Count > 0 ? list.Items[0] : null);
            if (sel != null) { sel.Selected = true; sel.EnsureVisible(); }

            if (profiles.Count == 0)
                lblInfo.Text = "Скопируйте ключ (vless://…) или ссылку подписки из бота Gemera VPN\nи нажмите «Вставить ключ из буфера».";
            else if (!connected)
                lblInfo.Text = "Выберите сервер и нажмите «Подключить». Серверов: " + profiles.Count;
        }

        string PingText(ServerProfile p)
        {
            if (!pings.TryGetValue(p.Link, out int ms)) return "";
            return ms < 0 ? "нет ответа" : ms + " мс";
        }

        ServerProfile SelectedProfile()
        {
            if (list.SelectedItems.Count > 0) return (ServerProfile)list.SelectedItems[0].Tag;
            return profiles.FirstOrDefault();
        }

        async Task OnSelectionChanged()
        {
            var p = list.SelectedItems.Count > 0 ? (ServerProfile)list.SelectedItems[0].Tag : null;
            if (p == null) return;
            if (store.Get("selected") != p.Link) { store.Set("selected", p.Link); SaveStore(); }
            if (connected && !busy && p.Link != activeLink) await Connect(); // switch server on the fly
        }

        void DeleteSelected()
        {
            var p = list.SelectedItems.Count > 0 ? (ServerProfile)list.SelectedItems[0].Tag : null;
            if (p == null) return;
            string warn = p.FromSubscription ? "\n\nСервер из подписки вернётся после её обновления." : "";
            if (MessageBox.Show(this, "Удалить сервер «" + p.DisplayName + "»?" + warn, "SaharVPN",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            if (p.FromSubscription) store.SubscriptionLinks.Remove(p.Link);
            else store.ManualLinks.Remove(p.Link);
            SaveStore();
            RefreshList();
        }

        // ------------------------------------------------------------------ import

        async Task PasteFromClipboard()
        {
            string text = "";
            try { text = Clipboard.GetText(); } catch { }
            var r = Net.ParseImport(text);
            if (r.Error != null) { Info(r.Error, MessageBoxIcon.Warning); return; }

            if (r.SubscriptionUrl != null)
            {
                store.Set("subUrl", r.SubscriptionUrl);
                SaveStore();
                await UpdateSubscription(true);
                return;
            }

            int added = 0;
            foreach (var l in r.Links)
            {
                if (store.ManualLinks.Contains(l) || store.SubscriptionLinks.Contains(l)) continue;
                store.ManualLinks.Add(l);
                added++;
            }
            if (r.Links.Count > 0) store.Set("selected", r.Links[0]);
            SaveStore();
            RefreshList();
            Info(added > 0 ? "Добавлено серверов: " + added + ".\nТеперь нажмите «Подключить»." : "Эти серверы уже есть в списке.");
        }

        async Task EditSubscription()
        {
            string url = Prompt("Подписка", "Ссылка подписки (https://…). Её выдаёт бот Gemera VPN:", store.Get("subUrl"));
            if (url == null) return;
            url = url.Trim();
            var r = Net.ParseImport(url);
            if (url.Length > 0 && r.SubscriptionUrl == null)
            {
                Info(r.Error ?? "Это не ссылка подписки. Ключи vless:// добавляйте кнопкой «Вставить ключ из буфера».", MessageBoxIcon.Warning);
                return;
            }
            store.Set("subUrl", r.SubscriptionUrl ?? "");
            if (url.Length == 0) store.SubscriptionLinks.Clear();
            SaveStore();
            if (url.Length > 0) await UpdateSubscription(true);
            else RefreshList();
        }

        async Task UpdateSubscription(bool interactive)
        {
            string url = store.Get("subUrl");
            if (url.Length == 0)
            {
                if (interactive) Info("Ссылка подписки не задана. Нажмите «Подписка…» и вставьте её.");
                return;
            }
            AppendLog("Обновляю подписку…");
            try
            {
                string body = await Net.DownloadSubscription(url, connected);
                var links = Net.ExtractLinks(body);
                if (links.Count == 0)
                {
                    AppendLog("Подписка не содержит поддерживаемых серверов. Начало ответа: " +
                              (body.Length > 200 ? body.Substring(0, 200) : body).Replace("\n", " "));
                    if (interactive) Info("В подписке нет серверов VLESS / Trojan / Shadowsocks.\n" +
                                          "Попросите в боте ключ vless://… и вставьте его кнопкой «Вставить ключ из буфера».", MessageBoxIcon.Warning);
                    return;
                }
                store.SubscriptionLinks = links;
                SaveStore();
                RefreshList();
                AppendLog("Подписка обновлена, серверов: " + links.Count);
                if (interactive) Info("Подписка обновлена. Серверов: " + links.Count + ".\nВыберите сервер и нажмите «Подключить».");
            }
            catch (Exception ex)
            {
                AppendLog("Ошибка загрузки подписки: " + ex.Message);
                if (interactive)
                    Info("Не удалось загрузить подписку:\n" + ex.Message + "\n\n" +
                         "Если на этом компьютере не открываются HTTPS-сайты, установите обновления Windows 7 " +
                         "(SP1 и KB3140245). Или вставьте ключ vless://… из бота напрямую.", MessageBoxIcon.Error);
            }
        }

        static string Prompt(string title, string label, string value)
        {
            using (var f = new Form())
            {
                f.Text = title;
                f.Font = new Font("Segoe UI", 9f);
                f.FormBorderStyle = FormBorderStyle.FixedDialog;
                f.StartPosition = FormStartPosition.CenterParent;
                f.MinimizeBox = f.MaximizeBox = false;
                f.ClientSize = new Size(520, 120);
                var l = new Label { Text = label, AutoSize = true, Location = new Point(12, 12) };
                var t = new TextBox { Text = value ?? "", Location = new Point(12, 38), Width = 496 };
                var ok = new Button { Text = "Сохранить", DialogResult = DialogResult.OK, Location = new Point(322, 78), Width = 90 };
                var cancel = new Button { Text = "Отмена", DialogResult = DialogResult.Cancel, Location = new Point(418, 78), Width = 90 };
                f.Controls.AddRange(new Control[] { l, t, ok, cancel });
                f.AcceptButton = ok;
                f.CancelButton = cancel;
                return f.ShowDialog() == DialogResult.OK ? t.Text : null;
            }
        }

        // ------------------------------------------------------------------ connection

        async Task OnStartup()
        {
            if (!File.Exists(store.XrayExe))
                AppendLog("Внимание: не найден файл " + store.XrayExe + " — распакуйте архив программы целиком.");
            if (store.Get("subUrl").Length > 0) await UpdateSubscription(false);
            if (chkAutoConnect.Checked && profiles.Count > 0) await Connect();
        }

        async Task ToggleConnection()
        {
            if (busy) return;
            if (connected) Disconnect();
            else await Connect();
        }

        async Task Connect()
        {
            if (busy) return;
            var p = SelectedProfile();
            if (p == null)
            {
                Info("Сначала добавьте сервер: скопируйте ключ из бота Gemera VPN и нажмите «Вставить ключ из буфера».");
                return;
            }
            if (!File.Exists(store.XrayExe))
            {
                Info("Не найдено ядро:\n" + store.XrayExe + "\n\nРаспакуйте архив SaharVPN целиком, вместе с папкой core.", MessageBoxIcon.Error);
                return;
            }

            busy = true;
            bool wasConnected = connected;
            connected = false;
            SetState(Icons.Busy, "Подключение…", p.DisplayName);
            try
            {
                File.WriteAllText(store.ConfigFile, XrayConfig.Build(p, chkRussia.Checked), Utf8);
                AppendLog("Подключаюсь к " + p.DisplayName + " (" + p.TypeLabel + ")");
                xray.Start(store.XrayExe, store.ConfigFile);
                await Task.Delay(1200);
                if (!xray.IsRunning)
                {
                    if (wasConnected) RestoreProxy();
                    busy = false;
                    SetState(Icons.Off, "Ошибка запуска", "Ядро Xray не запустилось — подробности в журнале ниже.");
                    Info("Не удалось запустить ядро Xray. Подробности — в журнале внизу окна.", MessageBoxIcon.Error);
                    return;
                }

                if (!wasConnected) BackupProxy();
                SystemProxy.EnableOurs();
                connected = true;
                activeLink = p.Link;
                busy = false;
                SetState(Icons.On, "Подключено", p.DisplayName + "\nПроверяю доступ в интернет…");
                RefreshList();

                int ms = await Net.ProxyDelay();
                if (!connected || activeLink != p.Link) return;
                lblInfo.Text = ms >= 0
                    ? p.DisplayName + "\nИнтернет через VPN работает, задержка " + ms + " мс"
                    : p.DisplayName + "\nВнимание: Сервер не отвечает. Проверьте ключ или выберите другой сервер.";
                AppendLog(ms >= 0 ? "Проверка связи: " + ms + " мс" : "Проверка связи: нет ответа через VPN");
                if (!Visible) tray.ShowBalloonTip(3000, "SaharVPN", "Подключено: " + p.DisplayName, ToolTipIcon.Info);
            }
            catch (Exception ex)
            {
                xray.Stop();
                RestoreProxy();
                connected = false;
                busy = false;
                SetState(Icons.Off, "Ошибка", ex.Message);
                AppendLog("Ошибка: " + ex);
            }
        }

        void Disconnect()
        {
            xray.Stop();
            RestoreProxy();
            connected = false;
            activeLink = null;
            SetState(Icons.Off, "Отключено", "VPN выключен, интернет идёт напрямую.");
            RefreshList();
            AppendLog("Отключено");
        }

        void OnXrayCrashed(int code)
        {
            if (busy || !connected) return;
            AppendLog("Ядро Xray неожиданно завершилось (код " + code + ")");
            Disconnect();
            SetState(Icons.Off, "Соединение прервано", "Ядро Xray завершилось с ошибкой — смотрите журнал ниже.");
            Info("VPN отключился: ядро Xray завершилось с ошибкой. Интернет снова идёт напрямую.", MessageBoxIcon.Warning);
        }

        async Task CheckConnection()
        {
            if (!connected) { Info("Сначала подключитесь."); return; }
            lblInfo.Text = "Проверяю…";
            int ms = await Net.ProxyDelay();
            string name = profiles.FirstOrDefault(x => x.Link == activeLink)?.DisplayName ?? "";
            lblInfo.Text = name + "\n" + (ms >= 0 ? "Интернет через VPN работает, задержка " + ms + " мс" : "Внимание: Нет ответа через VPN");
        }

        async Task PingAll()
        {
            var snapshot = profiles.ToList();
            AppendLog("Проверяю пинг " + snapshot.Count + " серверов…");
            var tasks = snapshot.Select(async p =>
            {
                int ms = await Net.TcpPing(p.Address, p.Port);
                pings[p.Link] = ms;
                foreach (ListViewItem item in list.Items)
                    if (((ServerProfile)item.Tag).Link == p.Link) item.SubItems[3].Text = PingText(p);
            });
            await Task.WhenAll(tasks);
        }

        // ------------------------------------------------------------------ system proxy / autostart

        void BackupProxy()
        {
            if (SystemProxy.IsOurs()) return;
            var st = SystemProxy.Read();
            store.Set("prevProxyEnable", st.Enable.ToString());
            store.Set("prevProxyServer", st.Server);
            store.Set("prevProxyOverride", st.Override);
            SaveStore();
        }

        void RestoreProxy()
        {
            try
            {
                if (!SystemProxy.IsOurs()) return;
                var prev = new SystemProxy.State
                {
                    Enable = store.Get("prevProxyEnable", "0") == "1" ? 1 : 0,
                    Server = store.Get("prevProxyServer"),
                    Override = store.Get("prevProxyOverride"),
                };
                if (prev.Server == SystemProxy.OurServer) prev = new SystemProxy.State();
                SystemProxy.Write(prev);
            }
            catch (Exception ex)
            {
                AppendLog("Не удалось вернуть настройки прокси: " + ex.Message);
            }
        }

        static bool IsAutostartEnabled()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(RunKey))
                return k?.GetValue("SaharVPN") is string v && v.IndexOf(Application.ExecutablePath, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        void SetAutostart(bool on)
        {
            try
            {
                using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
                {
                    if (on) k.SetValue("SaharVPN", "\"" + Application.ExecutablePath + "\" --autostart");
                    else k.DeleteValue("SaharVPN", false);
                }
            }
            catch (Exception ex)
            {
                Info("Не удалось изменить автозапуск: " + ex.Message, MessageBoxIcon.Error);
            }
        }

        // ------------------------------------------------------------------ exit

        void ExitApp()
        {
            Cleanup();
            Application.Exit();
        }

        void Cleanup()
        {
            if (exiting) return;
            exiting = true;
            xray.Stop();
            RestoreProxy();
            SaveStore();
            tray.Visible = false;
            tray.Dispose();
        }
    }
}
