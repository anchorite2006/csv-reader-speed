// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's
// {columns, rows, errors} for {text, header}, but scans with slices and indexOf
// instead of one character at a time.
//
// Semantics (from the spec, implemented from scratch):
// - U+FEFF at the very start is dropped.
// - A record ends at LF or CRLF; a line with no characters is no record.
// - Outside quotes a CR not followed by LF is dropped (stray_cr).
// - A field opening with '"' runs to the next undoubled '"'; '""' inside is one
//   '"'; each CRLF or lone CR inside reads as LF; what follows the closing
//   quote up to the next comma or line break is appended as it stands
//   (quote_junk, when the field ends); a quote that never closes is a literal
//   character and the text after it is read again as unquoted
//   (unterminated_quote).
// - A quote inside an unquoted field is a literal character; fields stay
//   strings, never trimmed or converted.
// - columns is the first record when header is true, else null; rows holds the
//   rest, each padded (short_row, with fields: its count) or cut (long_row,
//   with extra: the cut fields) to the first record's width.
// - Each error is {code, line, row}, in the order met; line is the 1-based
//   line its record starts on (every LF, CRLF and lone CR inside quotes
//   counted), row its record's index in rows (null for the header); a
//   record's short_row/long_row is reported when the record ends.
//
// Pure: no clock, no randomness, no locale, nothing kept between calls.

// How a field ended.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;
  let ended = END;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // Finish one record: first record sets the width (and becomes columns
  // under a header); the rest are padded or cut to it.
  function finish(fields, recordLine, recordRow) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  outer: while (pos < n) {
    // Fast path: a whole line with no quote and no CR is one plain record;
    // slice it once and split on commas (native, no per-character work).
    const eol = text.indexOf('\n', pos);
    const end = eol === -1 ? n : eol;
    const seg = text.slice(pos, end);
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      if (end === pos) {
        // An empty line is no record (at EOF there is nothing left either).
        if (eol === -1) break;
        pos = eol + 1;
        line += 1;
        continue;
      }
      const recordLine = line;
      const recordRow = header && columns === null ? null : rows.length;
      const fields = seg.split(',');
      pos = eol === -1 ? n : eol + 1;
      if (eol !== -1) line += 1;
      finish(fields, recordLine, recordRow);
      continue;
    }

    // General path: this line holds a quote or a CR, so parse it field by
    // field. First skip blank lines (\n or \r\n), which are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    let value = '';

    fieldLoop: while (true) {
      if (text.charCodeAt(pos) === 34) {
        // Quoted field: find the closing quote ("" counts as one quote).
        lastQuoted = true;
        const open = pos;
        const openLine = line;
        let q = text.indexOf('"', pos + 1);
        let doubled = false;
        while (q !== -1 && text.charCodeAt(q + 1) === 34) {
          doubled = true;
          q = text.indexOf('"', q + 2);
        }
        if (q === -1) {
          // Never closes: the quote is literal; read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          pos = open + 1;
          line = openLine;
          value = unquoted('"');
          fields.push(value);
          if (ended !== COMMA) break fieldLoop;
          continue fieldLoop;
        }
        // Content is text[open+1, q). Fast when it holds no "" and no CR/LF.
        const raw = text.slice(open + 1, q);
        if (!doubled && raw.indexOf('\n') === -1 && raw.indexOf('\r') === -1) {
          value = raw;
        } else {
          // Slow path: fold "" to " and every CR/LF run to one LF, counting
          // the line breaks back onto the line number.
          let parts = null;
          let segStart = 0;
          let p = 0;
          let breaks = 0;
          const m = raw.length;
          while (p < m) {
            const c = raw.charCodeAt(p);
            if (c === 34) {
              if (parts === null) parts = [];
              parts.push(raw.slice(segStart, p), '"');
              p += 2;
              segStart = p;
            } else if (c === 13) {
              if (parts === null) parts = [];
              parts.push(raw.slice(segStart, p), '\n');
              breaks += 1;
              p += raw.charCodeAt(p + 1) === 10 ? 2 : 1;
              segStart = p;
            } else if (c === 10) {
              if (parts === null) parts = [];
              parts.push(raw.slice(segStart, p), '\n');
              breaks += 1;
              p += 1;
              segStart = p;
            } else {
              p += 1;
            }
          }
          if (parts === null) {
            value = raw;
          } else {
            parts.push(raw.slice(segStart, m));
            value = parts.join('');
          }
          line += breaks;
        }
        pos = q + 1;
        if (pos >= n) {
          ended = END;
        } else {
          const c = text.charCodeAt(pos);
          if (c === 44) {
            pos += 1;
            ended = COMMA;
          } else if (c === 10) {
            pos += 1;
            line += 1;
            ended = LINE_BREAK;
          } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
            pos += 2;
            line += 1;
            ended = LINE_BREAK;
          } else {
            // Junk after the closing quote: read on as unquoted; a kept
            // character means quote_junk (reported when the field ends).
            const prefix = value;
            value = unquoted(prefix);
            if (value.length > prefix.length) {
              errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
          }
        }
        fields.push(value);
        if (ended !== COMMA) break fieldLoop;
      } else {
        // Unquoted field.
        lastQuoted = false;
        value = unquoted('');
        fields.push(value);
        if (ended !== COMMA) break fieldLoop;
      }
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue outer;

    finish(fields, recordLine, recordRow);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };

  // Reads unquoted characters from pos onto `prefix` up to the next comma or
  // line break; a CR not followed by LF is dropped (stray_cr). Sets `ended`
  // and returns the field value. `prefix` is the already-read head of the
  // field ('' for a plain unquoted field, the quoted content for junk, '"'
  // for an unterminated quote's re-read).
  function unquoted(prefix) {
    let val = null; // accumulated head once a stray CR splits the field
    let seg = pos;
    let stop = pos; // end of the kept tail (delimiter excluded)
    ended = END;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) {
        stop = pos;
        pos += 1;
        ended = COMMA;
        break;
      }
      if (c === 10) {
        stop = pos;
        pos += 1;
        line += 1;
        ended = LINE_BREAK;
        break;
      }
      if (c === 13) {
        if (text.charCodeAt(pos + 1) === 10) {
          stop = pos;
          pos += 2;
          line += 1;
          ended = LINE_BREAK;
          break;
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (val === null) val = text.slice(seg, pos);
        else val += text.slice(seg, pos);
        pos += 1;
        seg = pos;
        continue;
      }
      pos += 1;
    }
    if (ended === END) stop = pos;
    if (val === null) return prefix + text.slice(seg, stop);
    return prefix + val + text.slice(seg, stop);
  }
}
