// Secure CSV Utilities: Parser, Sanitizer, and Exporter
// Features protection against formula injection, oversized inputs, and malformed lines.

export interface CSVRow {
  [key: string]: string;
}

export function parseCSV(csvText: string, options: { maxRows?: number; maxCols?: number; maxCellLength?: number } = {}): {
  headers: string[];
  rows: CSVRow[];
  errors: string[];
} {
  const { maxRows = 2000, maxCols = 50, maxCellLength = 500 } = options;

  const rows: CSVRow[] = [];
  const errors: string[] = [];
  const headers: string[] = [];

  // Split by newlines, handling both CRLF and LF
  const lines = csvText.split(/\r?\n/);
  if (lines.length === 0 || !lines[0].trim()) {
    errors.push('CSV file is empty');
    return { headers, rows, errors };
  }

  if (lines.length > maxRows + 1) {
    errors.push(`CSV file exceeds maximum limit of ${maxRows} rows`);
    return { headers, rows, errors };
  }

  // Parse headers
  const headerLine = lines[0];
  const parsedHeaders = parseCSVLine(headerLine);
  if (parsedHeaders.length === 0) {
    errors.push('No headers found in the first row');
    return { headers, rows, errors };
  }

  if (parsedHeaders.length > maxCols) {
    errors.push(`CSV file exceeds maximum limit of ${maxCols} columns`);
    return { headers, rows, errors };
  }

  // Clean headers (trim whitespace, remove formulas)
  for (const h of parsedHeaders) {
    headers.push(sanitizeCSVCell(h.trim()));
  }

  // Parse rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    const cells = parseCSVLine(line);
    if (cells.length !== headers.length) {
      errors.push(`Row ${i + 1} has mismatched column count (expected ${headers.length}, got ${cells.length})`);
      continue;
    }

    const rowObj: CSVRow = {};
    let isCellOversized = false;

    for (let j = 0; j < headers.length; j++) {
      let val = cells[j];
      if (val.length > maxCellLength) {
        isCellOversized = true;
        break;
      }
      rowObj[headers[j]] = sanitizeCSVCell(val);
    }

    if (isCellOversized) {
      errors.push(`Row ${i + 1} contains a cell exceeding length limit of ${maxCellLength} characters`);
      continue;
    }

    rows.push(rowObj);
  }

  return { headers, rows, errors };
}

/**
 * Standard RFC-4180 compliant CSV line parser supporting quoted fields and double quotes
 */
function parseCSVLine(line: string): string[] {
  const cells: string[] = [];
  let inQuotes = false;
  let currentCell = '';

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped double quote
        currentCell += '"';
        i++;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of cell
      cells.push(currentCell);
      currentCell = '';
    } else {
      currentCell += char;
    }
  }
  cells.push(currentCell);
  return cells;
}

/**
 * Mitigate CSV/Formula Injection vulnerabilities (OWASP Recommendation)
 * Sanitizes cell values that begin with '=', '+', '-', '@' by prepending an apostrophe (')
 */
export function sanitizeCSVCell(value: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (
    trimmed.startsWith('=') ||
    trimmed.startsWith('+') ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('@')
  ) {
    // Return with escape character to prevent execution in spreadsheet software
    return `'${trimmed}`;
  }
  return trimmed;
}

/**
 * Formats data rows to RFC-4180 compliant CSV text
 */
export function formatCSV(headers: string[], rows: Record<string, any>[]): string {
  const headerLine = headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',');
  const rowLines = rows.map(row => {
    return headers
      .map(h => {
        let val = row[h] !== undefined && row[h] !== null ? String(row[h]) : '';
        // Sanitize for export injection
        val = sanitizeCSVCell(val);
        return `"${val.replace(/"/g, '""')}"`;
      })
      .join(',');
  });

  return [headerLine, ...rowLines].join('\r\n');
}
