//! Draws the mouse pointer into a capture. Screen grabs never include it, so the cursor is
//! rendered on its own and blended in where it was.
//!
//! Windows cursors can be colour with alpha, or old-style masks that invert what is under them
//! (the text I-beam usually is). Rendering the cursor once on black and once on white tells the
//! two apart: an ordinary pixel looks the same on both (or shows its alpha in the difference),
//! an inverting one comes out white on black and black on white.

use xcap::image::RgbaImage;

use super::geometry::Point;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pixel {
    /// Straight (not premultiplied) colour and alpha.
    Color([u8; 4]),
    /// Inverts what is underneath.
    Invert,
}

/// The pointer as it was on screen.
pub struct Cursor {
    /// Where its top-left corner was, in global physical pixels.
    pub origin: Point,
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<Pixel>,
}

/// Works out each pixel from the cursor rendered on black and on white (BGRA rows).
pub fn combine(on_black: &[u8], on_white: &[u8]) -> Vec<Pixel> {
    on_black
        .as_chunks::<4>()
        .0
        .iter()
        .zip(on_white.as_chunks::<4>().0)
        .map(|(b, w)| {
            let diff: i32 = (0..3).map(|i| w[i] as i32 - b[i] as i32).sum::<i32>() / 3;
            if diff < -128 {
                return Pixel::Invert;
            }
            let alpha = 255 - diff.max(0);
            if alpha == 0 {
                return Pixel::Color([0, 0, 0, 0]);
            }
            // On black, the rendered colour is the colour times its alpha.
            let channel = |i: usize| ((b[i] as i32 * 255 + alpha / 2) / alpha).min(255) as u8;
            Pixel::Color([channel(2), channel(1), channel(0), alpha as u8])
        })
        .collect()
}

impl Cursor {
    /// Blends the cursor into `image`, whose top-left corner is at `image_origin` on screen.
    pub fn draw_into(&self, image: &mut RgbaImage, image_origin: Point) {
        let (iw, ih) = image.dimensions();
        for cy in 0..self.height {
            for cx in 0..self.width {
                let x = self.origin.x + cx as i32 - image_origin.x;
                let y = self.origin.y + cy as i32 - image_origin.y;
                if x < 0 || y < 0 || x >= iw as i32 || y >= ih as i32 {
                    continue;
                }
                let px = image.get_pixel_mut(x as u32, y as u32);
                match self.pixels[(cy * self.width + cx) as usize] {
                    Pixel::Invert => {
                        for channel in &mut px.0[..3] {
                            *channel = 255 - *channel;
                        }
                    }
                    Pixel::Color([r, g, b, a]) if a > 0 => {
                        let a = a as u32;
                        for (c, v) in [r, g, b].into_iter().enumerate() {
                            px.0[c] =
                                ((v as u32 * a + px.0[c] as u32 * (255 - a) + 127) / 255) as u8;
                        }
                    }
                    Pixel::Color(_) => {}
                }
            }
        }
    }
}

/// The current mouse pointer, or `None` if it is hidden (or can't be read).
#[cfg(windows)]
pub fn grab() -> Option<Cursor> {
    use std::ffi::c_void;
    use windows::Win32::Graphics::Gdi::{
        BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, CreateDIBSection,
        DIB_RGB_COLORS, DeleteDC, DeleteObject, GetObjectW, HGDIOBJ, SelectObject,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CURSOR_SHOWING, CURSORINFO, DI_NORMAL, DrawIconEx, GetCursorInfo, GetIconInfo, HICON,
        ICONINFO,
    };

    unsafe {
        let mut info = CURSORINFO {
            cbSize: size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        GetCursorInfo(&mut info).ok()?;
        if info.flags.0 & CURSOR_SHOWING.0 == 0 || info.hCursor.is_invalid() {
            return None;
        }
        let icon = HICON(info.hCursor.0);
        let mut icon_info = ICONINFO::default();
        GetIconInfo(icon, &mut icon_info).ok()?;
        let size_of_bitmap = |bitmap: HGDIOBJ| {
            let mut bm = BITMAP::default();
            let ok = GetObjectW(
                bitmap,
                size_of::<BITMAP>() as i32,
                Some(&mut bm as *mut BITMAP as *mut c_void),
            );
            (ok != 0).then_some((bm.bmWidth, bm.bmHeight))
        };
        // A colour cursor has its own bitmap; a monochrome one stacks AND and XOR masks.
        let size = if !icon_info.hbmColor.is_invalid() {
            size_of_bitmap(icon_info.hbmColor.into())
        } else {
            size_of_bitmap(icon_info.hbmMask.into()).map(|(w, h)| (w, h / 2))
        };
        for bitmap in [icon_info.hbmColor, icon_info.hbmMask] {
            if !bitmap.is_invalid() {
                let _ = DeleteObject(bitmap.into());
            }
        }
        let (width, height) = size.filter(|&(w, h)| w > 0 && h > 0 && w <= 512 && h <= 512)?;

        let dc = CreateCompatibleDC(None);
        let header = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // top-down rows
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let bitmap_info = BITMAPINFO {
            bmiHeader: header,
            ..Default::default()
        };
        let mut bits: *mut c_void = std::ptr::null_mut();
        let Ok(dib) = CreateDIBSection(Some(dc), &bitmap_info, DIB_RGB_COLORS, &mut bits, None, 0)
        else {
            let _ = DeleteDC(dc);
            return None;
        };
        let old = SelectObject(dc, dib.into());
        let len = (width * height * 4) as usize;
        let render = |fill: u8| {
            std::ptr::write_bytes(bits as *mut u8, fill, len);
            let drawn = DrawIconEx(dc, 0, 0, icon, width, height, 0, None, DI_NORMAL);
            drawn
                .ok()
                .map(|_| std::slice::from_raw_parts(bits as *const u8, len).to_vec())
        };
        let on_black = render(0);
        let on_white = render(255);
        SelectObject(dc, old);
        let _ = DeleteObject(dib.into());
        let _ = DeleteDC(dc);

        Some(Cursor {
            origin: Point {
                x: info.ptScreenPos.x - icon_info.xHotspot as i32,
                y: info.ptScreenPos.y - icon_info.yHotspot as i32,
            },
            width: width as u32,
            height: height as u32,
            pixels: combine(&on_black?, &on_white?),
        })
    }
}

#[cfg(not(windows))]
pub fn grab() -> Option<Cursor> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use xcap::image::Rgba;

    #[test]
    fn tells_colour_transparent_and_inverting_pixels_apart() {
        // BGRA: opaque red, fully transparent, half-transparent white, inverting.
        let on_black = [0, 0, 255, 0, 0, 0, 0, 0, 128, 128, 128, 0, 255, 255, 255, 0];
        let on_white = [0, 0, 255, 0, 255, 255, 255, 0, 255, 255, 255, 0, 0, 0, 0, 0];
        let pixels = combine(&on_black, &on_white);
        assert_eq!(pixels[0], Pixel::Color([255, 0, 0, 255]));
        assert_eq!(pixels[1], Pixel::Color([0, 0, 0, 0]));
        assert_eq!(pixels[2], Pixel::Color([255, 255, 255, 128]));
        assert_eq!(pixels[3], Pixel::Invert);
    }

    #[test]
    fn draws_clipped_to_the_image() {
        let cursor = Cursor {
            origin: Point { x: 9, y: 19 },
            width: 2,
            height: 2,
            pixels: vec![
                Pixel::Color([255, 0, 0, 255]),
                Pixel::Invert,
                Pixel::Color([0, 0, 0, 0]),
                Pixel::Color([0, 0, 255, 255]),
            ],
        };
        // The image covers (10, 20)..(12, 22) on screen.
        let mut image = RgbaImage::from_pixel(2, 2, Rgba([10, 20, 30, 255]));
        cursor.draw_into(&mut image, Point { x: 10, y: 20 });
        // Only the cursor's bottom-right pixel lands on the image, at (0, 0).
        assert_eq!(image.get_pixel(0, 0).0, [0, 0, 255, 255]);
        assert_eq!(image.get_pixel(1, 1).0, [10, 20, 30, 255]);

        let mut image = RgbaImage::from_pixel(2, 2, Rgba([10, 20, 30, 255]));
        cursor.draw_into(&mut image, Point { x: 9, y: 19 });
        assert_eq!(image.get_pixel(0, 0).0, [255, 0, 0, 255]);
        assert_eq!(image.get_pixel(1, 0).0, [245, 235, 225, 255]);
        assert_eq!(image.get_pixel(0, 1).0, [10, 20, 30, 255]);
    }
}
