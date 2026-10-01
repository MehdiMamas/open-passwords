use windows::core::BSTR;
use windows::Win32::Foundation::{CloseHandle, HWND};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationValuePattern, UIA_DocumentControlTypeId,
    UIA_EditControlTypeId, UIA_ValuePatternId,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, VIRTUAL_KEY, VK_A, VK_BACK,
    VK_CONTROL,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, IsChild, GA_ROOT, GetAncestor,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FieldKind {
    Username,
    Password,
}

pub struct Foreground {
    pub process: String,
    pub title: String,
}

pub fn init_com() -> Result<(), String> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| format!("COM: {e}"))?;
    }
    Ok(())
}

pub fn foreground() -> Result<Foreground, String> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return Err("no foreground window".into());
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 || pid == GetCurrentProcessId() {
            return Err("foreground window is PassBridge".into());
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).map_err(|e| format!("process: {e}"))?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let query = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len);
        CloseHandle(process).ok();
        query.map_err(|e| format!("process name: {e}"))?;
        let full = String::from_utf16_lossy(&buf[..len as usize]);
        let process_name = full.rsplit(['\\', '/']).next().unwrap_or(&full).to_string();
        let mut title = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut title);
        let title = String::from_utf16_lossy(&title[..n.max(0) as usize]);
        Ok(Foreground { process: process_name, title })
    }
}

pub fn classify_focused() -> Result<FieldKind, String> {
    unsafe {
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(|e| format!("UI Automation: {e}"))?;
        let element = automation.GetFocusedElement().map_err(|e| format!("no focused element: {e}"))?;
        belongs_to_foreground(&element)?;
        field_kind(&element)
    }
}

pub fn type_secret(text: &str) -> Result<(), String> {
    unsafe {
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(|e| format!("UI Automation: {e}"))?;
        let element = automation.GetFocusedElement().map_err(|_| "no focused element".to_string())?;
        let kind = field_kind(&element).unwrap_or(FieldKind::Password);
        if !try_set_value(&element, text, kind) {
            send_text(text)?;
        }
        Ok(())
    }
}

unsafe fn field_kind(element: &IUIAutomationElement) -> Result<FieldKind, String> {
    let control = element.CurrentControlType().map_err(|e| format!("control type: {e}"))?;
    if control != UIA_EditControlTypeId && control != UIA_DocumentControlTypeId {
        return Err("focused control is not a text field".into());
    }
    let name = element.CurrentName().map(|s| String::from_utf16_lossy(&s)).unwrap_or_default();
    let id = element.CurrentAutomationId().map(|s| String::from_utf16_lossy(&s)).unwrap_or_default();
    let hay = format!("{name} {id}").to_ascii_lowercase();
    let password = hay.contains("password") || hay.contains("passwd") || hay.split_whitespace().any(|w| w == "pass");
    if password {
        Ok(FieldKind::Password)
    } else {
        Ok(FieldKind::Username)
    }
}

unsafe fn belongs_to_foreground(element: &IUIAutomationElement) -> Result<(), String> {
    let foreground = GetForegroundWindow();
    let hwnd = element.CurrentNativeWindowHandle().unwrap_or(HWND::default());
    if hwnd.0.is_null() {
        return Err("focused control is not in the foreground window".into());
    }
    let root = GetAncestor(hwnd, GA_ROOT);
    if hwnd == foreground || root == foreground || IsChild(foreground, hwnd).as_bool() {
        Ok(())
    } else {
        Err("focused control is not in the foreground window".into())
    }
}

unsafe fn try_set_value(element: &IUIAutomationElement, text: &str, kind: FieldKind) -> bool {
    if kind == FieldKind::Password {
        return false;
    }
    let Ok(pattern) = element.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) else {
        return false;
    };
    let value = BSTR::from(text);
    pattern.SetValue(&value).is_ok()
}

unsafe fn send_text(text: &str) -> Result<(), String> {
    chord(VK_CONTROL, VK_A);
    tap(VK_BACK);
    let mut inputs = Vec::new();
    for unit in text.encode_utf16() {
        inputs.push(unicode_input(unit, false));
        inputs.push(unicode_input(unit, true));
    }
    if inputs.is_empty() {
        return Ok(());
    }
    let sent = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    if sent as usize != inputs.len() {
        return Err("the window did not accept the keystrokes".into());
    }
    Ok(())
}

unsafe fn chord(modifier: VIRTUAL_KEY, key: VIRTUAL_KEY) {
    let inputs = [key_input(modifier, false), key_input(key, false), key_input(key, true), key_input(modifier, true)];
    SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
}

unsafe fn tap(key: VIRTUAL_KEY) {
    let inputs = [key_input(key, false), key_input(key, true)];
    SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
}

fn key_input(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

fn unicode_input(unit: u16, up: bool) -> INPUT {
    let mut flags = KEYEVENTF_UNICODE;
    if up {
        flags |= KEYEVENTF_KEYUP;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(0),
                wScan: unit,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
