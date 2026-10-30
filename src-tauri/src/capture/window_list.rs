//! Enumerates visible top-level windows so the overlay can highlight the window under the cursor.

use super::geometry::Rect;

/// Visible top-level windows in z-order, topmost first, as on-screen frame bounds.
#[cfg(windows)]
pub fn visible_windows() -> Vec<Rect> {
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
        let rects = unsafe { &mut *(lparam.0 as *mut Vec<Rect>) };
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
                rects.push(Rect::new(
                    bounds.left,
                    bounds.top,
                    width as u32,
                    height as u32,
                ));
            }
        }
        true.into()
    }

    let mut rects: Vec<Rect> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut rects as *mut Vec<Rect> as isize));
    }
    rects
}

#[cfg(not(windows))]
pub fn visible_windows() -> Vec<Rect> {
    Vec::new()
}
