//! The text items the engine emits, and the passes that clean them up.

/// Fraction of the font size above which a gap between two fragments is read
/// as a space rather than as kerning.
///
/// Kerning and word spacing overlap in real documents, so no single value is
/// right everywhere, and it has to be low. Some generators place every glyph
/// individually with an integer `Td` advance; the exact `/W` width is then
/// slightly wider than the advance, so gaps *inside* a word come out mildly
/// negative while a real space is clearly positive. A high ratio runs whole
/// sentences together ("FinancialAccountantspecializing"), and when that
/// happens to a person's name ("NABINACHARYA") it is worse still. Measured
/// across two corpora, 0.10 separates words reliably without splitting any.
const SPACE_GAP_RATIO: f64 = 0.10;

#[derive(Debug, Clone)]
pub struct TextItem {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub font_name: String,
    pub has_eol: bool,
}

pub struct Page {
    pub width: f64,
    pub items: Vec<TextItem>,
}

/// A show-text operator covers only as much text as the pdf chose to emit in
/// one go, which for a kerned document is a fragment of a word
/// ("SURESH", "T", "AMANG"). Merge consecutive fragments that share a baseline
/// and a font back into one item, inserting a space wherever the gap between
/// them is wide enough to be one. This reproduces the granularity the
/// javascript pipeline expects, where a line of text in a single font arrives
/// as a single item.
pub fn merge_runs(items: Vec<TextItem>) -> Vec<TextItem> {
    let mut merged: Vec<TextItem> = Vec::with_capacity(items.len());

    for item in items {
        let Some(previous) = merged.last_mut() else {
            merged.push(item);
            continue;
        };

        let baseline_tolerance = (previous.height * 0.3).max(1.0);
        let same_line = (item.y - previous.y).abs() <= baseline_tolerance;
        let same_font = item.font_name == previous.font_name;
        // Only merge forwards, so a column break or a backwards jump starts a
        // new item
        let previous_end = previous.x + previous.width;
        let gap = item.x - previous_end;
        let font_size = previous.height.max(item.height);

        // A different font normally marks a new item: a bold label and its
        // regular value should stay apart. But accented text is often set with
        // the diacritics in a separate font, which splits a single word into
        // "PHAN V", "\u{102}", "N D", "\u{168}", "NG". Glyphs that are touching
        // belong to the same word whatever font they came from, so a font
        // change only breaks the run when there is also a gap.
        let touching = gap.abs() <= font_size * 0.06;
        if !same_line
            || (!same_font && !touching)
            || gap < -font_size
            || gap > font_size * 2.5
        {
            merged.push(item);
            continue;
        }

        // The pdf often advances the text position instead of emitting a space
        // glyph, so spaces have to be reconstructed from the gaps. A space
        // glyph is around a quarter to a third of an em in most faces, while
        // kerning between letters is much tighter than that.
        if gap > font_size * SPACE_GAP_RATIO
            && !previous.text.ends_with(' ')
            && !item.text.starts_with(' ')
        {
            previous.text.push(' ');
        }
        previous.text.push_str(&item.text);
        previous.width = (item.x + item.width) - previous.x;
        previous.height = previous.height.max(item.height);
    }

    merged
}

/// Mark the last item on each baseline, which is what the javascript side uses
/// to group items into lines.
pub fn set_end_of_line_flags(items: &mut [TextItem]) {
    for i in 0..items.len() {
        let tolerance = (items[i].height * 0.3).max(2.0);
        let ends_line = match items.get(i + 1) {
            Some(next) => (next.y - items[i].y).abs() > tolerance,
            None => true,
        };
        items[i].has_eol = ends_line;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(text: &str, x: f64, width: f64, font: &str) -> TextItem {
        TextItem {
            text: text.to_string(),
            x,
            y: 700.0,
            width,
            height: 40.0,
            font_name: font.to_string(),
            has_eol: false,
        }
    }

    #[test]
    fn inserts_a_space_between_two_words_of_a_name() {
        // "NABIN" ends at 160, "ACHARYA" starts at 169: a 9pt gap at 40pt type.
        // The pdf advanced the position instead of drawing a space glyph.
        let merged = merge_runs(vec![
            item("NABIN", 20.0, 140.0, "Poppins-Bold"),
            item("ACHARYA", 169.0, 180.0, "Poppins-Bold"),
        ]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].text, "NABIN ACHARYA");
    }

    #[test]
    fn does_not_insert_a_space_for_kerning() {
        // "T" and "AMANG" are split by a kern, not a space
        let merged = merge_runs(vec![
            item("SURESH T", 20.0, 150.0, "CMBX12"),
            item("AMANG", 169.0, 100.0, "CMBX12"),
        ]);
        assert_eq!(merged.len(), 1);
        // A 1pt overlap is kerning; the fragments join with no space
        assert_eq!(merged[0].text, "SURESH TAMANG");
    }

    #[test]
    fn keeps_different_fonts_apart() {
        // A bold label and its regular value stay separate items, which is how
        // the javascript side tells a heading from its content
        let merged = merge_runs(vec![
            item("Backend", 20.0, 60.0, "CMBX10"),
            item("PHP, Laravel", 85.0, 120.0, "CMR10"),
        ]);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn starts_a_new_item_across_a_column_break() {
        // A large forward jump is a different column, not a wide space
        let merged = merge_runs(vec![
            item("sidebar", 20.0, 60.0, "Calibri"),
            item("main column", 400.0, 120.0, "Calibri"),
        ]);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn marks_the_last_item_on_each_line() {
        let mut items = vec![
            item("left", 20.0, 40.0, "Calibri"),
            item("right", 200.0, 40.0, "Calibri"),
            item("next line", 20.0, 40.0, "Calibri"),
        ];
        items[2].y = 600.0;
        set_end_of_line_flags(&mut items);
        assert_eq!(
            items.iter().map(|i| i.has_eol).collect::<Vec<_>>(),
            vec![false, true, true]
        );
    }
}

#[cfg(test)]
mod merge_font_tests {
    use super::*;

    fn glyph(text: &str, x: f64, width: f64, font: &str) -> TextItem {
        TextItem {
            text: text.to_string(),
            x,
            y: 671.0,
            width,
            height: 22.0,
            font_name: font.to_string(),
            has_eol: false,
        }
    }

    #[test]
    fn joins_a_word_whose_accents_come_from_another_font() {
        // Vietnamese text is often set with the diacritics in a separate font,
        // which splits one name into five items. They are touching, so they
        // belong to the same word regardless of the font change.
        let merged = merge_runs(vec![
            glyph("PHAN V", 371.0, 70.0, "ABCDEF+Arial"),
            glyph("\u{102}", 441.0, 14.0, "GHIJKL+ArialAccents"),
            glyph("N D", 455.0, 32.0, "ABCDEF+Arial"),
            glyph("\u{168}", 487.0, 14.0, "GHIJKL+ArialAccents"),
            glyph("NG", 501.0, 28.0, "ABCDEF+Arial"),
        ]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].text, "PHAN V\u{102}N D\u{168}NG");
    }

    #[test]
    fn still_separates_a_bold_label_from_its_value() {
        // A font change with a real gap is a label and its value, e.g.
        // "Backend" followed by "PHP, Laravel" -- those stay apart.
        let merged = merge_runs(vec![
            glyph("Backend", 20.0, 60.0, "ABCDEF+CMBX10"),
            glyph("PHP, Laravel", 95.0, 110.0, "GHIJKL+CMR10"),
        ]);
        assert_eq!(merged.len(), 2);
    }
}
