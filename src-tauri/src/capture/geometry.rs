use serde::{Deserialize, Serialize};

/// A point in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

/// An axis-aligned rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    pub fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn right(&self) -> i32 {
        self.x + self.width as i32
    }

    pub fn bottom(&self) -> i32 {
        self.y + self.height as i32
    }

    pub fn contains(&self, p: Point) -> bool {
        p.x >= self.x && p.x < self.right() && p.y >= self.y && p.y < self.bottom()
    }

    /// The overlapping area of two rectangles, or `None` if they don't overlap.
    pub fn intersect(&self, other: &Rect) -> Option<Rect> {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        let right = self.right().min(other.right());
        let bottom = self.bottom().min(other.bottom());
        (right > x && bottom > y).then(|| Rect::new(x, y, (right - x) as u32, (bottom - y) as u32))
    }

    pub fn translate(&self, dx: i32, dy: i32) -> Rect {
        Rect::new(self.x + dx, self.y + dy, self.width, self.height)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intersect_overlapping() {
        let a = Rect::new(0, 0, 100, 100);
        let b = Rect::new(50, -20, 100, 40);
        assert_eq!(a.intersect(&b), Some(Rect::new(50, 0, 50, 20)));
    }

    #[test]
    fn intersect_disjoint_or_touching() {
        let a = Rect::new(0, 0, 100, 100);
        assert_eq!(a.intersect(&Rect::new(200, 0, 10, 10)), None);
        assert_eq!(a.intersect(&Rect::new(100, 0, 10, 10)), None);
    }

    #[test]
    fn contains_is_half_open() {
        let r = Rect::new(-10, -10, 20, 20);
        assert!(r.contains(Point { x: -10, y: -10 }));
        assert!(r.contains(Point { x: 9, y: 9 }));
        assert!(!r.contains(Point { x: 10, y: 0 }));
    }

    #[test]
    fn translate_to_monitor_local() {
        let window = Rect::new(-1500, 200, 800, 600);
        assert_eq!(window.translate(1920, 0), Rect::new(420, 200, 800, 600));
    }
}
