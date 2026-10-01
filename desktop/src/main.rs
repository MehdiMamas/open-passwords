#![windows_subsystem = "windows"]

mod fill;
mod host;
mod rules;
mod session;
mod srp;

use fill::FieldKind;
use rules::{Rule, RuleFile};
use session::{Session, State};
use zeroize::Zeroizing;

fn main() {
    if let Err(err) = ui::run() {
        let _ = err;
    }
}

#[cfg(windows)]
mod ui {
    use std::sync::atomic::{AtomicBool, Ordering};

    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{ERROR_ALREADY_EXISTS, GetLastError, HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Threading::CreateMutexW;
    use windows::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT};
    use windows::Win32::UI::Shell::{
        Shell_NotifyIconW, NIF_ICON, NIF_INFO, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NIM_MODIFY, NOTIFYICONDATAW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DestroyWindow, DispatchMessageW,
        GetCursorPos, GetMessageW, GetWindowLongPtrW, GetWindowTextW, LoadIconW, MessageBoxW, PostQuitMessage,
        RegisterClassW, SendMessageW, SetForegroundWindow, SetWindowLongPtrW, SetWindowTextW, ShowWindow, TrackPopupMenu, TranslateMessage,
        BS_DEFPUSHBUTTON, CREATESTRUCTW, CS_HREDRAW, CS_VREDRAW, CW_USEDEFAULT, ES_AUTOHSCROLL, GWLP_USERDATA, HICON, HMENU,
        IDI_APPLICATION, MB_ICONINFORMATION, MB_OK, MF_STRING, MSG, SW_SHOW, TPM_RIGHTBUTTON, WINDOW_EX_STYLE, WINDOW_STYLE,
        WM_COMMAND, WM_DESTROY, WM_HOTKEY, WM_LBUTTONUP, WM_RBUTTONUP, WM_USER, WNDCLASSW, WS_CAPTION, WS_CHILD, WS_OVERLAPPED,
        WS_SYSMENU, WS_VISIBLE,
    };

    use super::{FieldKind, Rule, RuleFile, Session, State, Zeroizing};
    use crate::rules;
    use crate::session::Login;

    const HOTKEY_ID: i32 = 1;
    const TRAY_MSG: u32 = WM_USER + 1;
    const ID_UNLOCK: u32 = 1;
    const ID_RULES: u32 = 2;
    const ID_LOCK: u32 = 3;
    const ID_QUIT: u32 = 4;
    const IDC_EDIT: isize = 100;
    const IDC_LIST: isize = 200;
    const IDC_PROCESS: isize = 201;
    const IDC_TITLE: isize = 202;
    const IDC_URL: isize = 203;
    const IDC_ADD: isize = 204;
    const IDC_REMOVE: isize = 205;
    const IDC_SAVE: isize = 206;

    static BUSY: AtomicBool = AtomicBool::new(false);

    struct App {
        session: Session,
        rules: RuleFile,
    }

    struct DialogState {
        done: bool,
        edit: HWND,
        text: String,
        cancelled: bool,
    }

    struct RulesState {
        done: bool,
        cancelled: bool,
        rules: Vec<Rule>,
        list: HWND,
        process: HWND,
        title: HWND,
        url: HWND,
    }

    pub fn run() -> Result<(), String> {
        unsafe {
            let mutex = CreateMutexW(None, true, w!("Local\\PassBridgeDesktop")).map_err(|e| format!("mutex: {e}"))?;
            if GetLastError() == ERROR_ALREADY_EXISTS {
                return Ok(());
            }
            let _ = mutex;
            crate::fill::init_com()?;
            let instance = GetModuleHandleW(None).map_err(|e| format!("module: {e}"))?;
            let class_name = w!("PassBridgeDesktop");
            let wc = WNDCLASSW {
                style: CS_HREDRAW | CS_VREDRAW,
                lpfnWndProc: Some(tray_proc),
                hInstance: instance.into(),
                lpszClassName: class_name,
                ..Default::default()
            };
            if RegisterClassW(&wc) == 0 {
                return Err("could not register the window class".into());
            }
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                class_name,
                w!("PassBridge"),
                WINDOW_STYLE::default(),
                0,
                0,
                0,
                0,
                None,
                None,
                Some(instance.into()),
                None,
            )
            .map_err(|e| format!("window: {e}"))?;
            add_tray(hwnd)?;
            if RegisterHotKey(Some(hwnd), HOTKEY_ID, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, 0x50).is_err() {
                balloon(hwnd, "PassBridge", "Ctrl+Alt+P is already in use");
            }
            let app = App {
                session: Session::new(),
                rules: rules::load(),
            };
            let app = Box::into_raw(Box::new(app));
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, app as isize);
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg).as_bool();
                DispatchMessageW(&msg);
            }
            Ok(())
        }
    }

    unsafe fn app_mut(hwnd: HWND) -> Option<&'static mut App> {
        let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut App;
        if ptr.is_null() {
            None
        } else {
            Some(&mut *ptr)
        }
    }

    unsafe extern "system" fn tray_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match msg {
            TRAY_MSG => {
                let mouse = lparam.0 as u32;
                if mouse == WM_RBUTTONUP || mouse == WM_LBUTTONUP {
                    show_menu(hwnd);
                }
                LRESULT(0)
            }
            WM_HOTKEY => {
                on_hotkey(hwnd);
                LRESULT(0)
            }
            WM_COMMAND => {
                on_command(hwnd, (wparam.0 & 0xffff) as u32);
                LRESULT(0)
            }
            WM_DESTROY => {
                remove_tray(hwnd);
                if let Some(app) = app_mut(hwnd) {
                    app.session.lock();
                    let _ = Box::from_raw(app as *mut App);
                }
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }

    unsafe fn on_command(hwnd: HWND, id: u32) {
        match id {
            ID_QUIT => {
                let _ = DestroyWindow(hwnd);
            }
            ID_LOCK => {
                if let Some(app) = app_mut(hwnd) {
                    app.session.lock();
                    balloon(hwnd, "PassBridge", "Locked");
                }
            }
            ID_UNLOCK => {
                if let Err(err) = ensure_unlocked(hwnd) {
                    balloon(hwnd, "PassBridge", &err);
                } else {
                    balloon(hwnd, "PassBridge", "Unlocked");
                }
            }
            ID_RULES => {
                let current = app_mut(hwnd).map(|app| app.rules.rules.clone()).unwrap_or_default();
                if let Some(updated) = rules_dialog(current) {
                    if let Some(app) = app_mut(hwnd) {
                        app.rules.rules = updated;
                        if let Err(err) = rules::save(&app.rules) {
                            balloon(hwnd, "PassBridge", &err);
                        } else {
                            balloon(hwnd, "PassBridge", "Saved app rules");
                        }
                    }
                }
            }
            _ => {}
        }
    }

    unsafe fn on_hotkey(hwnd: HWND) {
        if BUSY.swap(true, Ordering::SeqCst) {
            return;
        }
        let outcome: Result<(), String> = (|| {
            let fg = crate::fill::foreground()?;
            if rules::is_browser(&fg.process) {
                return Ok(());
            }
            let rule = {
                let app = app_mut(hwnd).ok_or_else(|| "PassBridge is not ready".to_string())?;
                let Some(rule) = rules::find(&app.rules.rules, &fg.process, &fg.title).cloned() else {
                    return Ok(());
                };
                rule
            };
            ensure_unlocked(hwnd)?;
            let logins = {
                let app = app_mut(hwnd).ok_or_else(|| "PassBridge is not ready".to_string())?;
                app.session.logins_for(&rule.url).map_err(|e| e.message)?
            };
            if logins.is_empty() {
                balloon(hwnd, "PassBridge", "No saved login for this app");
                return Ok(());
            }
            let login = if logins.len() == 1 {
                logins.into_iter().next().unwrap()
            } else {
                match pick_login(&logins) {
                    Some(login) => login,
                    None => return Ok(()),
                }
            };
            let kind = match crate::fill::classify_focused() {
                Ok(kind) => kind,
                Err(err) => {
                    balloon(hwnd, "PassBridge", &err);
                    return Ok(());
                }
            };
            let secret: Zeroizing<String> = {
                let app = app_mut(hwnd).ok_or_else(|| "PassBridge is not ready".to_string())?;
                match kind {
                    FieldKind::Password => app.session.password_for(&rule.url, &login.username).map_err(|e| e.message)?,
                    FieldKind::Username => Zeroizing::new(login.username.clone()),
                }
            };
            crate::fill::type_secret(&secret)?;
            let which = match kind {
                FieldKind::Password => "Filled password",
                FieldKind::Username => "Filled username",
            };
            balloon(hwnd, "PassBridge", which);
            Ok(())
        })();
        if let Err(err) = outcome {
            balloon(hwnd, "PassBridge", &err);
        }
        BUSY.store(false, Ordering::SeqCst);
    }

    unsafe fn ensure_unlocked(hwnd: HWND) -> Result<(), String> {
        loop {
            {
                let app = app_mut(hwnd).ok_or_else(|| "PassBridge is not ready".to_string())?;
                if app.session.state() == State::Unlocked {
                    return Ok(());
                }
                if app.session.state() != State::NeedsPin {
                    app.session.connect().map_err(|e| e.message)?;
                }
                if !app.session.has_challenge() {
                    app.session.request_challenge().map_err(|e| e.message)?;
                }
            }
            let Some(pin) = pin_dialog("Enter the 6-digit code your PC is showing") else {
                return Err("Unlock cancelled".into());
            };
            let result = {
                let app = app_mut(hwnd).ok_or_else(|| "PassBridge is not ready".to_string())?;
                app.session.verify_pin(&pin)
            };
            match result {
                Ok(()) => return Ok(()),
                Err(err) if err.reissued => continue,
                Err(err) => {
                    MessageBoxW(None, pcw(&wide(&err.message)), w!("PassBridge"), MB_OK | MB_ICONINFORMATION);
                }
            }
        }
    }

    unsafe fn show_menu(hwnd: HWND) {
        let Ok(menu) = CreatePopupMenu() else {
            return;
        };
        let _ = AppendMenuW(menu, MF_STRING, ID_UNLOCK as usize, w!("Unlock"));
        let _ = AppendMenuW(menu, MF_STRING, ID_LOCK as usize, w!("Lock"));
        let _ = AppendMenuW(menu, MF_STRING, ID_RULES as usize, w!("App rules..."));
        let _ = AppendMenuW(menu, MF_STRING, ID_QUIT as usize, w!("Quit"));
        let mut point = POINT::default();
        let _ = GetCursorPos(&mut point);
        let _ = SetForegroundWindow(hwnd);
        let _ = TrackPopupMenu(menu, TPM_RIGHTBUTTON, point.x, point.y, Some(0), hwnd, None);
        let _ = DestroyMenu(menu);
    }

    unsafe fn add_tray(hwnd: HWND) -> Result<(), String> {
        let mut tip = [0u16; 128];
        copy_utf16("PassBridge", &mut tip);
        let nid = NOTIFYICONDATAW {
            cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: hwnd,
            uID: 1,
            uFlags: NIF_MESSAGE | NIF_ICON | NIF_TIP,
            uCallbackMessage: TRAY_MSG,
            hIcon: LoadIconW(None, IDI_APPLICATION).unwrap_or(HICON::default()),
            szTip: tip,
            ..Default::default()
        };
        if !Shell_NotifyIconW(NIM_ADD, &nid).as_bool() {
            return Err("could not create the tray icon".into());
        }
        let _ = nid;
        Ok(())
    }

    unsafe fn balloon(hwnd: HWND, title: &str, text: &str) {
        let mut tip = [0u16; 128];
        let mut info = [0u16; 256];
        let mut info_title = [0u16; 64];
        copy_utf16("PassBridge", &mut tip);
        copy_utf16(text, &mut info);
        copy_utf16(title, &mut info_title);
        let nid = NOTIFYICONDATAW {
            cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: hwnd,
            uID: 1,
            uFlags: NIF_INFO,
            szTip: tip,
            szInfo: info,
            szInfoTitle: info_title,
            ..Default::default()
        };
        let _ = Shell_NotifyIconW(NIM_MODIFY, &nid);
    }

    unsafe fn remove_tray(hwnd: HWND) {
        let nid = NOTIFYICONDATAW {
            cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: hwnd,
            uID: 1,
            ..Default::default()
        };
        let _ = Shell_NotifyIconW(NIM_DELETE, &nid);
    }

    unsafe fn pin_dialog(message: &str) -> Option<String> {
        let instance = GetModuleHandleW(None).ok()?;
        let class_name = w!("PassBridgePin");
        let wc = WNDCLASSW {
            lpfnWndProc: Some(pin_proc),
            hInstance: instance.into(),
            lpszClassName: class_name,
            ..Default::default()
        };
        RegisterClassW(&wc);
        let mut state = DialogState { done: false, edit: HWND::default(), text: String::new(), cancelled: false };
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class_name,
            w!("PassBridge"),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            420,
            180,
            None,
            None,
            Some(instance.into()),
            Some(&mut state as *mut DialogState as *const std::ffi::c_void),
        )
        .ok()?;
        let _ = ShowWindow(hwnd, SW_SHOW);
        let mut msg = MSG::default();
        while !state.done && GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg).as_bool();
            DispatchMessageW(&msg);
        }
        let _ = SetWindowTextW(hwnd, pcw(&wide(message)));
        if state.cancelled || state.text.is_empty() {
            None
        } else {
            Some(state.text)
        }
    }

    unsafe extern "system" fn pin_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if msg == windows::Win32::UI::WindowsAndMessaging::WM_CREATE {
            let cs = &*(lparam.0 as *const CREATESTRUCTW);
            let state = cs.lpCreateParams as *mut DialogState;
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, state as isize);
            let instance = GetModuleHandleW(None).unwrap_or_default();
            let edit = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("EDIT"),
                w!(""),
                WS_CHILD | WS_VISIBLE | WINDOW_STYLE(ES_AUTOHSCROLL as u32),
                20,
                50,
                360,
                24,
                Some(hwnd),
                Some(HMENU(IDC_EDIT as *mut std::ffi::c_void)),
                Some(instance.into()),
                None,
            )
            .unwrap_or_default();
            let _ = CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("BUTTON"),
                w!("Unlock"),
                WS_CHILD | WS_VISIBLE | WINDOW_STYLE(BS_DEFPUSHBUTTON as u32),
                300,
                90,
                80,
                28,
                Some(hwnd),
                Some(HMENU(1 as *mut std::ffi::c_void)),
                Some(instance.into()),
                None,
            );
            if let Some(state) = state.as_mut() {
                state.edit = edit;
            }
            return LRESULT(0);
        }
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut DialogState;
        if msg == WM_COMMAND && (wparam.0 & 0xffff) == 1 {
            if let Some(state) = state.as_mut() {
                state.text = window_text(state.edit);
                state.done = true;
            }
            let _ = DestroyWindow(hwnd);
            return LRESULT(0);
        }
        if msg == WM_DESTROY {
            if let Some(state) = state.as_mut() {
                if !state.done {
                    state.cancelled = true;
                    state.done = true;
                }
            }
            return LRESULT(0);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    unsafe fn rules_dialog(rules: Vec<Rule>) -> Option<Vec<Rule>> {
        let instance = GetModuleHandleW(None).ok()?;
        let class_name = w!("PassBridgeRules");
        let wc = WNDCLASSW {
            lpfnWndProc: Some(rules_proc),
            hInstance: instance.into(),
            lpszClassName: class_name,
            ..Default::default()
        };
        RegisterClassW(&wc);
        let mut state = RulesState {
            done: false,
            cancelled: false,
            rules,
            list: HWND::default(),
            process: HWND::default(),
            title: HWND::default(),
            url: HWND::default(),
        };
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class_name,
            w!("PassBridge app rules"),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            520,
            360,
            None,
            None,
            Some(instance.into()),
            Some(&mut state as *mut RulesState as *const std::ffi::c_void),
        )
        .ok()?;
        let _ = ShowWindow(hwnd, SW_SHOW);
        let mut msg = MSG::default();
        while !state.done && GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg).as_bool();
            DispatchMessageW(&msg);
        }
        if state.cancelled {
            None
        } else {
            Some(state.rules)
        }
    }

    unsafe extern "system" fn rules_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        use windows::Win32::UI::WindowsAndMessaging::{LB_DELETESTRING, LB_GETCURSEL, WM_CREATE};
        if msg == WM_CREATE {
            let cs = &*(lparam.0 as *const CREATESTRUCTW);
            let state = cs.lpCreateParams as *mut RulesState;
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, state as isize);
            let instance = GetModuleHandleW(None).unwrap_or_default();
            let list = child(hwnd, instance.into(), "LISTBOX", "", 20, 20, 470, 140, IDC_LIST);
            let process = child(hwnd, instance.into(), "EDIT", "", 20, 180, 140, 24, IDC_PROCESS);
            let title = child(hwnd, instance.into(), "EDIT", "", 170, 180, 140, 24, IDC_TITLE);
            let url = child(hwnd, instance.into(), "EDIT", "", 320, 180, 170, 24, IDC_URL);
            let _ = child_button(hwnd, instance.into(), "Add", 20, 220, 80, 28, IDC_ADD);
            let _ = child_button(hwnd, instance.into(), "Remove", 110, 220, 80, 28, IDC_REMOVE);
            let _ = child_button(hwnd, instance.into(), "Save", 400, 270, 90, 28, IDC_SAVE);
            if let Some(state) = state.as_mut() {
                state.list = list;
                state.process = process;
                state.title = title;
                state.url = url;
                refill_list(state);
            }
            return LRESULT(0);
        }
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut RulesState;
        if msg == WM_COMMAND {
            let id = (wparam.0 & 0xffff) as isize;
            if let Some(state) = state.as_mut() {
                if id == IDC_ADD {
                    let rule = Rule {
                        process: window_text(state.process),
                        title_contains: window_text(state.title),
                        url: window_text(state.url),
                    };
                    if !rule.process.is_empty() && rule.url.starts_with("https://") {
                        state.rules.push(rule);
                        refill_list(state);
                    }
                } else if id == IDC_REMOVE {
                    let sel = SendMessageW(state.list, LB_GETCURSEL, None, None).0;
                    if sel >= 0 {
                        let sel = sel as usize;
                        if sel < state.rules.len() {
                            state.rules.remove(sel);
                            let _ = SendMessageW(state.list, LB_DELETESTRING, Some(WPARAM(sel)), None);
                        }
                    }
                } else if id == IDC_SAVE {
                    state.done = true;
                    let _ = DestroyWindow(hwnd);
                }
            }
            return LRESULT(0);
        }
        if msg == WM_DESTROY {
            if let Some(state) = state.as_mut() {
                if !state.done {
                    state.cancelled = true;
                    state.done = true;
                }
            }
            return LRESULT(0);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    unsafe fn refill_list(state: &RulesState) {
        use windows::Win32::UI::WindowsAndMessaging::{LB_ADDSTRING, LB_RESETCONTENT};
        let _ = SendMessageW(state.list, LB_RESETCONTENT, None, None);
        for rule in &state.rules {
            let label = format!("{}  {}", rule.process, rule.url);
            let wide = wide(&label);
            let _ = SendMessageW(state.list, LB_ADDSTRING, None, Some(LPARAM(wide.as_ptr() as isize)));
        }
    }

    unsafe fn pick_login(logins: &[Login]) -> Option<Login> {
        let items: Vec<String> = logins.iter().map(|login| login.username.clone()).collect();
        let index = choose_dialog("Choose a login", &items)?;
        logins.get(index).cloned()
    }

    struct ChooseState {
        done: bool,
        cancelled: bool,
        list: HWND,
        items: Vec<String>,
        selected: Option<usize>,
    }

    unsafe fn choose_dialog(title: &str, items: &[String]) -> Option<usize> {
        let instance = GetModuleHandleW(None).ok()?;
        let class_name = w!("PassBridgeChoose");
        let wc = WNDCLASSW {
            lpfnWndProc: Some(choose_proc),
            hInstance: instance.into(),
            lpszClassName: class_name,
            ..Default::default()
        };
        RegisterClassW(&wc);
        let mut state = ChooseState {
            done: false,
            cancelled: false,
            list: HWND::default(),
            items: items.to_vec(),
            selected: None,
        };
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class_name,
            w!("PassBridge"),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_VISIBLE,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            360,
            280,
            None,
            None,
            Some(instance.into()),
            Some(&mut state as *mut ChooseState as *const std::ffi::c_void),
        )
        .ok()?;
        let _ = SetWindowTextW(hwnd, pcw(&wide(title)));
        let _ = ShowWindow(hwnd, SW_SHOW);
        let mut msg = MSG::default();
        while !state.done {
            let status = GetMessageW(&mut msg, None, 0, 0);
            if !status.as_bool() {
                break;
            }
            let _ = TranslateMessage(&msg).as_bool();
            DispatchMessageW(&msg);
        }
        state.selected.filter(|_| !state.cancelled)
    }

    unsafe extern "system" fn choose_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        use windows::Win32::UI::WindowsAndMessaging::{LB_ADDSTRING, LB_GETCURSEL, WM_CREATE};
        if msg == WM_CREATE {
            let cs = &*(lparam.0 as *const CREATESTRUCTW);
            let state = cs.lpCreateParams as *mut ChooseState;
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, state as isize);
            let instance = GetModuleHandleW(None).unwrap_or_default();
            let list = child(hwnd, instance.into(), "LISTBOX", "", 16, 16, 310, 160, IDC_LIST);
            let _ = child_button(hwnd, instance.into(), "Use", 240, 190, 80, 28, 1);
            if let Some(state) = state.as_mut() {
                state.list = list;
                for item in &state.items {
                    let wide = wide(item);
                    let _ = SendMessageW(list, LB_ADDSTRING, None, Some(LPARAM(wide.as_ptr() as isize)));
                }
            }
            return LRESULT(0);
        }
        let state = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut ChooseState;
        if msg == WM_COMMAND && (wparam.0 & 0xffff) == 1 {
            if let Some(state) = state.as_mut() {
                let sel = SendMessageW(state.list, LB_GETCURSEL, None, None).0;
                if sel >= 0 {
                    state.selected = Some(sel as usize);
                    state.done = true;
                    let _ = DestroyWindow(hwnd);
                }
            }
            return LRESULT(0);
        }
        if msg == WM_DESTROY {
            if let Some(state) = state.as_mut() {
                if !state.done {
                    state.cancelled = true;
                    state.done = true;
                }
            }
            return LRESULT(0);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    unsafe fn child(parent: HWND, instance: windows::Win32::Foundation::HINSTANCE, class: &str, text: &str, x: i32, y: i32, w: i32, h: i32, id: isize) -> HWND {
        let class = wide(class);
        let text = wide(text);
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            PCWSTR(class.as_ptr()),
            PCWSTR(text.as_ptr()),
            WS_CHILD | WS_VISIBLE | WINDOW_STYLE(ES_AUTOHSCROLL as u32),
            x,
            y,
            w,
            h,
            Some(parent),
            Some(HMENU(id as *mut std::ffi::c_void)),
            Some(instance),
            None,
        )
        .unwrap_or_default()
    }

    unsafe fn child_button(parent: HWND, instance: windows::Win32::Foundation::HINSTANCE, text: &str, x: i32, y: i32, w: i32, h: i32, id: isize) -> HWND {
        let text = wide(text);
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            w!("BUTTON"),
            PCWSTR(text.as_ptr()),
            WS_CHILD | WS_VISIBLE,
            x,
            y,
            w,
            h,
            Some(parent),
            Some(HMENU(id as *mut std::ffi::c_void)),
            Some(instance),
            None,
        )
        .unwrap_or_default()
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe fn pcw(buf: &[u16]) -> PCWSTR {
        PCWSTR(buf.as_ptr())
    }

    fn copy_utf16(text: &str, dest: &mut [u16]) {
        dest.fill(0);
        for (i, unit) in text.encode_utf16().take(dest.len().saturating_sub(1)).enumerate() {
            dest[i] = unit;
        }
    }

    unsafe fn window_text(hwnd: HWND) -> String {
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut buf);
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }
}
