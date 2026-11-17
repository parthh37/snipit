//! The Windows "Select folder" dialog, for choosing where snips are saved.

use std::path::{Path, PathBuf};

/// Shows the folder picker over `owner` (a window handle), starting in `start`. Returns `None`
/// when cancelled. Blocks until the dialog closes, so call it off the main thread.
#[cfg(windows)]
pub fn pick(owner: Option<isize>, start: Option<&Path>) -> Result<Option<PathBuf>, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Foundation::{ERROR_CANCELLED, HWND};
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoCreateInstance,
        CoInitializeEx, CoTaskMemFree, CoUninitialize,
    };
    use windows::Win32::UI::Shell::{
        FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, FileOpenDialog, IFileOpenDialog, IShellItem,
        SHCreateItemFromParsingName, SIGDN_FILESYSPATH,
    };
    use windows::core::{HSTRING, PCWSTR, w};

    unsafe {
        // The dialog needs a single-threaded apartment; this worker thread has no COM yet.
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        let result = (|| -> windows::core::Result<Option<PathBuf>> {
            let dialog: IFileOpenDialog =
                CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            dialog.SetOptions(dialog.GetOptions()? | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)?;
            dialog.SetTitle(w!("Save snips in"))?;
            if let Some(start) = start.filter(|p| p.is_dir()) {
                let wide: Vec<u16> = start.as_os_str().encode_wide().chain([0]).collect();
                if let Ok(item) =
                    SHCreateItemFromParsingName::<_, _, IShellItem>(PCWSTR(wide.as_ptr()), None)
                {
                    let _ = dialog.SetFolder(&item);
                }
            }
            let owner = owner.map(|h| HWND(h as *mut _));
            if let Err(err) = dialog.Show(owner) {
                return if err.code() == ERROR_CANCELLED.to_hresult() {
                    Ok(None)
                } else {
                    Err(err)
                };
            }
            let item = dialog.GetResult()?;
            let name = item.GetDisplayName(SIGDN_FILESYSPATH)?;
            let path = PathBuf::from(HSTRING::from_wide(name.as_wide()).to_os_string());
            CoTaskMemFree(Some(name.0 as *const _));
            Ok(Some(path))
        })();
        if initialized.is_ok() {
            CoUninitialize();
        }
        result.map_err(|e| format!("Couldn't open the folder picker: {e}"))
    }
}

#[cfg(not(windows))]
pub fn pick(_owner: Option<isize>, _start: Option<&Path>) -> Result<Option<PathBuf>, String> {
    Err("Choosing a folder is only supported on Windows".into())
}
