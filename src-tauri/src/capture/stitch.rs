//! Stitches the frames of a scrolling capture into one tall image.
//!
//! Each frame is the same screen area grabbed after another scroll step. Columns that don't
//! change between two frames (window borders, fixed sidebars, blank margins) and a thin margin
//! at both edges (where scrollbars sit) are left out, and the remaining columns of each row are
//! hashed in vertical segments, so a hover effect or an animation only spoils part of a row.
//! Rows that stay put between two frames at the top and bottom (browser toolbars, sticky
//! headers and footers) are left out of the matching: the stitched image keeps the first
//! frame's top and the last frame's bottom.

use xcap::image::{RgbaImage, imageops};

/// Vertical segments each row is hashed in.
const SEGMENTS: usize = 16;
/// Fewest content rows two frames must share for a shift to be trusted.
const MIN_OVERLAP: usize = 12;
/// Fewest matching segments for a shift to be trusted.
const MIN_MATCHES: u32 = 24;
/// Share of the compared segments that must match for a shift to be trusted.
const MATCH_RATIO: f64 = 0.75;
/// Share of the rows with content that must be unchanged for a frame to count as not scrolled.
const STILL_RATIO: f64 = 0.9;

/// Per-row segment hashes of a frame.
struct Signature {
    /// `SEGMENTS` hashes per row.
    hashes: Vec<u64>,
    /// Bit `s` is set when segment `s` of the row is a single colour.
    uniform: Vec<u16>,
}

impl Signature {
    /// Hashes every column of `image`.
    fn of(image: &RgbaImage) -> Self {
        let columns: Vec<usize> = (0..image.width() as usize).collect();
        Self::of_columns(image, &columns)
    }

    /// Hashes only `columns` (in increasing order) of `image`, split into `SEGMENTS` runs.
    fn of_columns(image: &RgbaImage, columns: &[usize]) -> Self {
        let width = image.width() as usize;
        let height = image.height() as usize;
        let pixels = image.as_raw().as_chunks::<4>().0;
        let n = columns.len();
        let segments = SEGMENTS.min(n.max(1));
        let mut hashes = Vec::with_capacity(height * SEGMENTS);
        let mut uniform = Vec::with_capacity(height);
        for y in 0..height {
            let row = &pixels[y * width..(y + 1) * width];
            let mut mask = 0u16;
            for s in 0..SEGMENTS {
                let run = &columns[(s * n / segments).min(n)..((s + 1) * n / segments).min(n)];
                if s >= segments || run.is_empty() {
                    // Fewer than SEGMENTS columns: the spare segments are empty.
                    hashes.push(0);
                    mask |= 1 << s;
                    continue;
                }
                let first = row[run[0]];
                let mut same = true;
                let mut hash = 0xcbf2_9ce4_8422_2325u64;
                for &x in run {
                    let px = row[x];
                    same &= px == first;
                    let value = u32::from_le_bytes(px);
                    hash = (hash ^ u64::from(value)).wrapping_mul(0x0000_0100_0000_01b3);
                }
                hashes.push(hash);
                if same {
                    mask |= 1 << s;
                }
            }
            uniform.push(mask);
        }
        Self { hashes, uniform }
    }

    fn rows(&self) -> usize {
        self.uniform.len()
    }

    fn row(&self, y: usize) -> &[u64] {
        &self.hashes[y * SEGMENTS..(y + 1) * SEGMENTS]
    }

    fn rows_equal(&self, y: usize, other: &Signature, other_y: usize) -> bool {
        self.row(y) == other.row(other_y)
    }

    /// Whether the row has anything but flat colour in it.
    fn has_content(&self, y: usize) -> bool {
        self.uniform[y] != u16::MAX
    }
}

/// Whether `b` shows the same thing as `a`, give or take a little animation: the page didn't
/// scroll.
pub fn is_still(a: &RgbaImage, b: &RgbaImage) -> bool {
    a.dimensions() != b.dimensions() || a.as_raw() == b.as_raw() || {
        let (a, b) = (Signature::of(a), Signature::of(b));
        signatures_still(&a, &b)
    }
}

fn signatures_still(a: &Signature, b: &Signature) -> bool {
    let mut content = 0usize;
    let mut unchanged = 0usize;
    for y in 0..a.rows() {
        if a.has_content(y) || b.has_content(y) {
            content += 1;
            if a.rows_equal(y, b, y) {
                unchanged += 1;
            }
        }
    }
    content == 0 || unchanged as f64 >= STILL_RATIO * content as f64
}

/// What happened to a frame given to [`Stitcher::push`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    /// The view didn't move (the end of the page, or the scroll didn't reach it).
    Still,
    /// The view moved down `shift` rows, which were added to the image. `span` is how many rows
    /// of the frame scroll at all (the frame minus its fixed top and bottom).
    Scrolled { shift: u32, span: u32 },
    /// The frame couldn't be lined up with the previous one (it scrolled too far, or there was
    /// nothing but blank space to match on). It was dropped.
    Lost,
}

pub struct Stitcher {
    width: u32,
    frame_height: usize,
    /// The stitched image so far, as RGBA rows.
    rows: Vec<u8>,
    last_frame: RgbaImage,
    /// How many rows at the end of `rows` are known to be the last frame's bottom rows.
    tail: usize,
    /// Columns at each side left out of the matching, where scrollbars sit.
    margin: usize,
    /// Per margin column (the left margin, then the right one), how many rows didn't move with
    /// the page; out of `edge_rows` compared. A scrollbar or window border shows up here and is
    /// trimmed off the result, since its pieces from different frames don't line up.
    edge_misses: Vec<u64>,
    edge_rows: u64,
}

/// Share of rows a margin column may get wrong before it counts as not part of the page.
const EDGE_NOISE: f64 = 0.02;

impl Stitcher {
    /// `margin` columns at each side are ignored when lining frames up: enough to cover a
    /// scrollbar. Those that turn out not to scroll with the page are trimmed off the result.
    pub fn new(first: RgbaImage, margin: u32) -> Self {
        // Never so wide that nothing is left to match on.
        let margin = (margin as usize).min(first.width() as usize / 6);
        Self {
            width: first.width(),
            frame_height: first.height() as usize,
            rows: first.as_raw().clone(),
            tail: first.height() as usize,
            margin,
            edge_misses: vec![0; margin * 2],
            edge_rows: 0,
            last_frame: first,
        }
    }

    /// Records how well the margin columns follow a shift of `d` for `next` rows `from..to`.
    fn track_edges(&mut self, next: &RgbaImage, from: usize, to: usize, d: usize) {
        let width = self.width as usize;
        let a = self.last_frame.as_raw().as_chunks::<4>().0;
        let b = next.as_raw().as_chunks::<4>().0;
        for i in 0..self.margin * 2 {
            let x = if i < self.margin {
                i
            } else {
                width - self.margin * 2 + i
            };
            self.edge_misses[i] += (from..to)
                .filter(|&y| a[(y + d) * width + x] != b[y * width + x])
                .count() as u64;
        }
        self.edge_rows += (to - from) as u64;
    }

    /// Columns to trim off the left and right of the result: out to the innermost margin column
    /// that didn't move with the page.
    fn edge_trim(&self) -> (usize, usize) {
        if self.edge_rows == 0 {
            return (0, 0);
        }
        let noisy = |i: usize| self.edge_misses[i] as f64 > EDGE_NOISE * self.edge_rows as f64;
        let m = self.margin;
        let left = (0..m).filter(|&i| noisy(i)).map(|i| i + 1).max();
        let right = (0..m).filter(|&i| noisy(m + i)).map(|i| m - i).max();
        (left.unwrap_or(0), right.unwrap_or(0))
    }

    /// Columns worth comparing between the last frame and `next`: inside the margins, and not
    /// identical in both frames (borders, fixed sidebars and blank margins don't scroll).
    fn moving_columns(&self, next: &RgbaImage) -> Vec<usize> {
        let width = self.width as usize;
        let a = self.last_frame.as_raw().as_chunks::<4>().0;
        let b = next.as_raw().as_chunks::<4>().0;
        (self.margin..width - self.margin)
            .filter(|&x| (0..self.frame_height).any(|y| a[y * width + x] != b[y * width + x]))
            .collect()
    }

    /// Height of the stitched image so far.
    pub fn height(&self) -> u32 {
        (self.rows.len() / self.row_bytes()) as u32
    }

    fn row_bytes(&self) -> usize {
        self.width as usize * 4
    }

    /// Adds the next frame, grabbed after scrolling further down.
    pub fn push(&mut self, frame: RgbaImage) -> Step {
        if frame.width() != self.width || frame.height() as usize != self.frame_height {
            return Step::Lost;
        }
        if frame.as_raw() == self.last_frame.as_raw() {
            return Step::Still;
        }
        if signatures_still(&Signature::of(&self.last_frame), &Signature::of(&frame)) {
            return Step::Still;
        }
        let columns = self.moving_columns(&frame);
        if columns.len() < SEGMENTS {
            return Step::Still;
        }
        let prev = &Signature::of_columns(&self.last_frame, &columns);
        let next = Signature::of_columns(&frame, &columns);

        let h = self.frame_height;
        // Rows that stayed in place: fixed toolbars and headers above, footers below.
        let top = (0..h).take_while(|&y| prev.rows_equal(y, &next, y)).count();
        let bottom = (top..h)
            .rev()
            .take_while(|&y| prev.rows_equal(y, &next, y))
            .count();
        let span = h - top - bottom;
        if span <= MIN_OVERLAP || bottom > self.tail {
            return Step::Still;
        }

        // A shift of `d` means next[y] == prev[y + d] for the scrolling rows.
        let mut best: Option<(i64, usize, u32, u32)> = None;
        for d in 1..=span - MIN_OVERLAP {
            let floor = best.map(|b| b.0);
            if let Some((matches, misses)) = score(prev, &next, top, h - bottom - d, d, floor) {
                let value = i64::from(matches) - i64::from(misses);
                if floor.is_none_or(|f| value > f) {
                    best = Some((value, d, matches, misses));
                }
            }
        }
        let Some((_, shift, matches, misses)) = best else {
            return Step::Lost;
        };
        if matches < MIN_MATCHES || f64::from(matches) < MATCH_RATIO * f64::from(matches + misses) {
            return Step::Lost;
        }

        self.track_edges(&frame, top, h - bottom - shift, shift);

        // The image ends with the previous frame's bottom rows: swap its fixed footer for the
        // newly revealed rows plus this frame's footer.
        let row_bytes = self.row_bytes();
        self.rows.truncate(self.rows.len() - bottom * row_bytes);
        let start = (h - bottom - shift) * row_bytes;
        self.rows.extend_from_slice(&frame.as_raw()[start..]);
        self.tail = (self.tail + shift).min(h - top);
        self.last_frame = frame;
        Step::Scrolled {
            shift: shift as u32,
            span: span as u32,
        }
    }

    /// The stitched image, minus edge columns that didn't scroll with the page (scrollbars,
    /// window borders).
    pub fn finish(self) -> RgbaImage {
        let (left, right) = self.edge_trim();
        let height = self.height();
        let image = RgbaImage::from_raw(self.width, height, self.rows).expect("rows are whole");
        if left + right == 0 {
            return image;
        }
        let width = self.width - (left + right) as u32;
        imageops::crop_imm(&image, left as u32, 0, width, height).to_image()
    }
}

/// Matching and mismatching segments when `next` rows `from..to` are lined up with `prev` rows
/// `d` further down. Segments that are the same flat colour in both prove nothing and are
/// skipped. Gives up early (returns `None`) once the result can't beat `floor`.
fn score(
    prev: &Signature,
    next: &Signature,
    from: usize,
    to: usize,
    d: usize,
    floor: Option<i64>,
) -> Option<(u32, u32)> {
    let mut matches = 0u32;
    let mut misses = 0u32;
    for y in from..to {
        let a = prev.row(y + d);
        let b = next.row(y);
        let flat = prev.uniform[y + d] & next.uniform[y];
        for s in 0..SEGMENTS {
            if a[s] != b[s] {
                misses += 1;
            } else if flat & (1 << s) == 0 {
                matches += 1;
            }
        }
        if let Some(floor) = floor {
            let best_possible =
                i64::from(matches) - i64::from(misses) + ((to - y - 1) * SEGMENTS) as i64;
            if best_possible <= floor {
                return None;
            }
        }
    }
    Some((matches, misses))
}

#[cfg(test)]
mod tests {
    use super::*;
    use xcap::image::Rgba;

    const WIDTH: u32 = 200;
    /// Columns on the right where the frames draw a scrollbar that moves with the page.
    const SCROLLBAR: u32 = 8;

    /// A long "page": every row a different noisy pattern, with a blank band in the middle.
    fn page(height: u32) -> RgbaImage {
        let mut seed = 0x2545_f491_4f6c_dd1du64;
        RgbaImage::from_fn(WIDTH, height, |_, y| {
            if (300..330).contains(&y) {
                return Rgba([255, 255, 255, 255]);
            }
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let v = seed.to_le_bytes();
            Rgba([v[0], v[1], v[2], 255])
        })
    }

    fn band(height: u32, color: [u8; 3]) -> RgbaImage {
        RgbaImage::from_fn(WIDTH, height, |x, y| {
            let shade = ((x * 7 + y * 13) % 40) as u8;
            Rgba([color[0] ^ shade, color[1], color[2] ^ shade, 255])
        })
    }

    /// Columns the stitcher is told to ignore at each side.
    const MARGIN: u32 = 12;
    /// A fixed divider line inside the margins, like the edge of a fixed sidebar.
    const DIVIDER: u32 = 60;

    /// What the screen shows with the page scrolled to `offset`: a fixed header and footer
    /// around `view` rows of the page, like a browser window. As in real windows, the outer
    /// columns are a border with a slight vertical gradient, and the scrollbar runs the full
    /// height beside the header too.
    fn frame(
        page: &RgbaImage,
        header: &RgbaImage,
        footer: &RgbaImage,
        view: u32,
        offset: u32,
    ) -> RgbaImage {
        let height = header.height() + view + footer.height();
        let thumb = 2 + offset * height / page.height();
        RgbaImage::from_fn(WIDTH, height, |x, y| {
            let content_y = y.wrapping_sub(header.height());
            if x == 0 || x == WIDTH - 1 {
                let shade = 170 + (y % 9) as u8;
                return Rgba([shade, shade, shade, 255]);
            }
            if x == DIVIDER {
                return Rgba([0, 100 + (y % 13) as u8, 0, 255]);
            }
            if x >= WIDTH - 1 - SCROLLBAR && y >= 2 {
                return if (thumb..thumb + 20).contains(&y) {
                    Rgba([90, 90, 90, 255])
                } else {
                    Rgba([230, 230, 230, 255])
                };
            }
            if y < header.height() {
                *header.get_pixel(x, y)
            } else if content_y < view {
                *page.get_pixel(x, offset + content_y)
            } else {
                *footer.get_pixel(x, y - header.height() - view)
            }
        })
    }

    /// Checks the stitched image is `expected` with the left border and the scrollbar plus right
    /// border trimmed off, ignoring the divider line.
    fn assert_same_content(actual: &RgbaImage, expected: &RgbaImage) {
        assert_eq!(
            actual.dimensions(),
            (WIDTH - 2 - SCROLLBAR, expected.height()),
            "border and scrollbar trimmed"
        );
        for y in 0..expected.height() {
            for x in (1..WIDTH - 1 - SCROLLBAR).filter(|&x| x != DIVIDER) {
                assert_eq!(
                    actual.get_pixel(x - 1, y),
                    expected.get_pixel(x, y),
                    "({x}, {y})"
                );
            }
        }
    }

    fn scroll_through(header_rows: u32, footer_rows: u32, step: u32) {
        let page = page(900);
        let header = band(header_rows, [200, 40, 40]);
        let footer = band(footer_rows, [40, 40, 200]);
        let view = 160;
        let last = page.height() - view;

        let mut offset = 0;
        let mut stitcher = Stitcher::new(frame(&page, &header, &footer, view, offset), MARGIN);
        while offset < last {
            let next = (offset + step).min(last);
            let result = stitcher.push(frame(&page, &header, &footer, view, next));
            assert!(
                matches!(result, Step::Scrolled { shift, .. } if shift == next - offset),
                "{offset} -> {next}: {result:?}"
            );
            offset = next;
        }
        // Scrolling at the bottom of the page does nothing.
        let result = stitcher.push(frame(&page, &header, &footer, view, offset));
        assert_eq!(result, Step::Still);

        let image = stitcher.finish();
        let expected_height = header_rows + page.height() + footer_rows;
        let expected = RgbaImage::from_fn(WIDTH, expected_height, |x, y| {
            if y < header_rows {
                *header.get_pixel(x, y)
            } else if y < header_rows + page.height() {
                *page.get_pixel(x, y - header_rows)
            } else {
                *footer.get_pixel(x, y - header_rows - page.height())
            }
        });
        assert_same_content(&image, &expected);
    }

    #[test]
    fn stitches_a_plain_page() {
        scroll_through(0, 0, 70);
    }

    #[test]
    fn keeps_fixed_header_and_footer_once() {
        scroll_through(24, 16, 90);
    }

    #[test]
    fn handles_small_and_large_steps() {
        scroll_through(10, 0, 13);
        scroll_through(10, 0, 140);
    }

    #[test]
    fn rejects_frames_without_overlap() {
        let page = page(900);
        let header = band(0, [0, 0, 0]);
        let footer = band(0, [0, 0, 0]);
        let mut stitcher = Stitcher::new(frame(&page, &header, &footer, 160, 0), MARGIN);
        // Scrolled further than the view is tall: nothing in common.
        let result = stitcher.push(frame(&page, &header, &footer, 160, 400));
        assert_eq!(result, Step::Lost);
        assert_eq!(stitcher.height(), 160);
        // The stitcher still lines up with the last good frame.
        let result = stitcher.push(frame(&page, &header, &footer, 160, 60));
        assert!(matches!(result, Step::Scrolled { shift: 60, .. }));
    }

    #[test]
    fn small_animation_is_still() {
        let a = band(120, [10, 120, 10]);
        let mut b = a.clone();
        for y in 40..46 {
            for x in 0..30 {
                b.put_pixel(x, y, Rgba([255, 0, 0, 255]));
            }
        }
        assert!(is_still(&a, &b));
        assert!(is_still(&a, &a.clone()));
    }
}
