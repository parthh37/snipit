use std::borrow::Cow;

use arboard::{Clipboard, ImageData};
use tauri::ipc::{InvokeBody, Request, Response};
use xcap::image::{self, ImageFormat, RgbaImage};

use crate::gallery;

pub fn copy_image(image: &RgbaImage) -> Result<(), String> {
    Clipboard::new()
        .and_then(|mut clipboard| {
            clipboard.set_image(ImageData {
                width: image.width() as usize,
                height: image.height() as usize,
                bytes: Cow::Borrowed(image.as_raw()),
            })
        })
        .map_err(|e| e.to_string())
}

/// Reads an image from the clipboard, or `None` when it holds no image.
pub fn read_image() -> Result<Option<RgbaImage>, String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    match clipboard.get_image() {
        Ok(data) => Ok(RgbaImage::from_raw(
            data.width as u32,
            data.height as u32,
            data.bytes.into_owned(),
        )),
        Err(arboard::Error::ContentNotAvailable) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Copies PNG bytes (the raw request body) to the clipboard as an image.
#[tauri::command]
pub fn copy_png(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(png) = request.body() else {
        return Err("Expected PNG bytes".into());
    };
    let image = image::load_from_memory_with_format(png, ImageFormat::Png)
        .map_err(|e| e.to_string())?
        .to_rgba8();
    copy_image(&image)
}

/// Returns the clipboard image as PNG bytes; an empty body means there is no image.
#[tauri::command]
pub fn paste_image() -> Result<Response, String> {
    let png = match read_image()? {
        Some(image) => gallery::encode_png(&image)?,
        None => Vec::new(),
    };
    Ok(Response::new(png))
}
