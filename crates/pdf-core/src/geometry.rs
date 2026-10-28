//! The 2x3 affine matrix pdf uses for coordinate transforms.

/// A pdf matrix [a b c d e f], representing
/// | a b 0 |
/// | c d 0 |
/// | e f 1 |
#[derive(Debug, Clone, Copy)]
pub struct Matrix {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Matrix {
    pub const IDENTITY: Matrix = Matrix { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 };

    pub fn mul(self, other: Matrix) -> Matrix {
        Matrix {
            a: self.a * other.a + self.b * other.c,
            b: self.a * other.b + self.b * other.d,
            c: self.c * other.a + self.d * other.c,
            d: self.c * other.b + self.d * other.d,
            e: self.e * other.a + self.f * other.c + other.e,
            f: self.e * other.b + self.f * other.d + other.f,
        }
    }

    pub fn translate(tx: f64, ty: f64) -> Matrix {
        Matrix { a: 1.0, b: 0.0, c: 0.0, d: 1.0, e: tx, f: ty }
    }

    /// Horizontal scale factor this matrix applies.
    pub fn x_scale(&self) -> f64 {
        (self.a * self.a + self.b * self.b).sqrt()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_leaves_a_matrix_unchanged() {
        let m = Matrix { a: 2.0, b: 0.0, c: 0.0, d: 3.0, e: 10.0, f: 20.0 };
        let product = m.mul(Matrix::IDENTITY);
        assert_eq!((product.a, product.d, product.e, product.f), (2.0, 3.0, 10.0, 20.0));
    }

    #[test]
    fn translation_composes_in_the_scaled_space() {
        // Translating by 5 in a space scaled 2x lands at 10 in device space
        let scale = Matrix { a: 2.0, b: 0.0, c: 0.0, d: 2.0, e: 0.0, f: 0.0 };
        let product = Matrix::translate(5.0, 0.0).mul(scale);
        assert_eq!(product.e, 10.0);
    }

    #[test]
    fn x_scale_reports_the_horizontal_factor() {
        assert_eq!(Matrix { a: 3.0, b: 4.0, c: 0.0, d: 1.0, e: 0.0, f: 0.0 }.x_scale(), 5.0);
        assert_eq!(Matrix::IDENTITY.x_scale(), 1.0);
    }
}
