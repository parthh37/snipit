//! Enumerates visible top-level windows so the overlay can highlight the window under the cursor.

use super::geometry::Rect;

#[derive(Debug, Clone, Copy)]
pub struct TopWindow {
    /// On-screen frame bounds.
    pub bounds: Rect,
    /// The window handle (`HWND`), so a scrolling capture can bring it to the front.
    pub handle: isize,
}

/// Visible top-level windows in z-order, topmost first.
#[cfg(windows)]
pub fn visible_windows() -> Vec<TopWindow> {
    use std::ffi::c_void;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{
        DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GWL_EXSTYLE, GetClassNameW, GetWindowLongPtrW, IsIconic, IsWindowVisible,
        WS_EX_TRANSPARENT,
    };
    use windows::core::BOOL;

    // Desktop background windows: clicking the desktop should capture the whole monitor.
    const SKIPPED_CLASSES: [&str; 2] = ["Progman", "WorkerW"];

    unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let found = unsafe { &mut *(lparam.0 as *mut Vec<TopWindow>) };
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                return true.into();
            }
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            if ex_style & WS_EX_TRANSPARENT.0 != 0 {
                return true.into();
            }
            // Cloaked windows (other virtual desktops, suspended UWP apps) are not on screen.
            let mut cloaked = 0u32;
            let cloaked_ok = DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut c_void,
                size_of::<u32>() as u32,
            );
            if cloaked_ok.is_ok() && cloaked != 0 {
                return true.into();
            }
            let mut class = [0u16; 64];
            let len = GetClassNameW(hwnd, &mut class) as usize;
            let class = String::from_utf16_lossy(&class[..len]);
            if SKIPPED_CLASSES.contains(&class.as_str()) {
                return true.into();
            }
            // Extended frame bounds exclude the invisible resize borders around windows.
            let mut bounds = RECT::default();
            if DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut bounds as *mut RECT as *mut c_void,
                size_of::<RECT>() as u32,
            )
            .is_err()
            {
                return true.into();
            }
            let width = bounds.right - bounds.left;
            let height = bounds.bottom - bounds.top;
            if width > 0 && height > 0 {
                found.push(TopWindow {
                    bounds: Rect::new(bounds.left, bounds.top, width as u32, height as u32),
                    handle: hwnd.0 as isize,
                });
            }
        }
        true.into()
    }

    let mut found: Vec<TopWindow> = Vec::new();
    unsafe {
        let _ = EnumWindows(
            Some(collect),
            LPARAM(&mut found as *mut Vec<TopWindow> as isize),
        );
    }
    found
}

#[cfg(not(windows))]
pub fn visible_windows() -> Vec<TopWindow> {
    Vec::new()
}

/// The program (executable name without `.exe`) and title of a window, for naming and
/// searching snips.
#[cfg(windows)]
pub fn describe(handle: isize) -> (Option<String>, Option<String>) {
    use windows::Win32::Foundation::{CloseHandle, HWND};
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowTextW, GetWindowThreadProcessId};
    use windows::core::PWSTR;

    let hwnd = HWND(handle as *mut _);
    let mut title = [0u16; 256];
    let len = unsafe { GetWindowTextW(hwnd, &mut title) } as usize;
    let title = String::from_utf16_lossy(&title[..len]).trim().to_owned();

    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    let app = (pid != 0)
        .then(|| unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok())
        .flatten()
        .and_then(|process| {
            let mut buf = [0u16; 1024];
            let mut size = buf.len() as u32;
            let ok = unsafe {
                QueryFullProcessImageNameW(
                    process,
                    PROCESS_NAME_WIN32,
                    PWSTR(buf.as_mut_ptr()),
                    &mut size,
                )
            };
            unsafe {
                let _ = CloseHandle(process);
            }
            ok.ok()?;
            let path = String::from_utf16_lossy(&buf[..size as usize]);
            std::path::Path::new(&path)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
        });
    (app, (!title.is_empty()).then_some(title))
}

#[cfg(not(windows))]
pub fn describe(_handle: isize) -> (Option<String>, Option<String>) {
    (None, None)
}
