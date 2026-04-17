import pdf from 'pdf-parse';
import Tesseract from 'tesseract.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function cleanText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanLine(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function safeNumber(v) {
  const cleaned = String(v).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function extractField(text, patterns) {
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m && m[1]) return cleanLine(m[1]);
  }
  return '';
}

function detectProvider(lines, text) {
  const direct = extractField(text, [
    /raz[oó]n social[:\s]+([^\n]+)/i,
    /señores[:\s]+([^\n]+)/i,
    /proveedor[:\s]+([^\n]+)/i,
    /empresa[:\s]+([^\n]+)/i,
    /cotizaci[oó]n[:\s]+([^\n]+)/i,
  ]);
  if (direct) return direct;

  const likely = lines.find(l =>
    /s\.r\.l|srl|s\.a\.|sa\b|sociedad|electric|electro|ferreter|materiales|industrial|servicios/i.test(l)
  );
  return likely || '';
}

function detectTotal(lines, text) {
  const candidates = lines.filter(l => /total\b|importe total|neto final|total final/i.test(l));
  for (const line of candidates) {
    const m = line.match(/([\d.]+[,\.]\d{2}|\d+)/g);
    if (m && m.length) return safeNumber(m[m.length - 1]);
  }
  const fallback = text.match(/(?:total|importe total|neto final)[:\s$]*([\d\.,]+)/i);
  return fallback ? safeNumber(fallback[1]) : 0;
}

// Conocer items por nombre para fuzzy matching
const knownItemPatterns = [
  { id: 1, patterns: [/prensacable.*2["pulg]/i, /prensa.*2/i] },
  { id: 2, patterns: [/prensacable.*1["pulg]/i, /prensa.*1/i] },
  { id: 3, patterns: [/prensacable.*3\/4/i, /prensa.*3\/4/i] },
  { id: 4, patterns: [/riel din/i, /riel.*din/i] },
  { id: 5, patterns: [/terminal.*bimet.*150/i, /bimet.*150/i] },
  { id: 6, patterns: [/terminal.*bimet.*70/i, /bimet.*70/i] },
  { id: 7, patterns: [/interruptor.*200a/i, /int.*200.*regulable/i] },
  { id: 8, patterns: [/interruptor.*160a/i, /int.*160.*regulable/i] },
  { id: 9, patterns: [/diferencial/i, /protecc.*diferencial/i] },
  { id: 10, patterns: [/gabinete.*700.*600/i, /gabinete.*ip65/i] },
  { id: 11, patterns: [/barra.*tetrapolar.*250/i, /barra.*250a/i] },
  { id: 12, patterns: [/cable.*70mm/i, /unipolar.*70/i] },
  { id: 13, patterns: [/terminal.*cobre.*70/i, /terminal.*70mm/i] },
  { id: 14, patterns: [/bandeja.*200mm/i, /portacable.*200/i] },
  { id: 15, patterns: [/jabalina.*1[.,]5/i, /jabalina.*3\/4/i] },
  { id: 16, patterns: [/bobina.*4mm/i, /cable.*4mm.*100m/i] },
  { id: 17, patterns: [/terminal.*ojal.*4mm/i, /ojal.*estañado.*4/i] },
  { id: 18, patterns: [/smart energy/i, /bgh.*spc01/i, /spc01/i] },
  { id: 19, patterns: [/utp.*cat.*6/i, /cable.*utp.*exterior/i] },
];

function extractTableItems(lines, text) {
  const extracted = [];
  
  lines.forEach((line, idx) => {
    // Detectar líneas con precios
    const hasPrice = /\$?\s*[\d.,]+\s*$/.test(line) || /[\d.,]+[,\.]\d{2}/.test(line);
    if (!hasPrice || line.length < 10) return;

    // Buscar precio numérico al final
    const priceMatches = line.match(/([\d.]+[,\.]\d{2}|\d{3,}(?:[.,]\d{2})?)/g);
    const lastPrice = priceMatches ? safeNumber(priceMatches[priceMatches.length - 1]) : 0;
    if (!lastPrice || lastPrice < 100) return;

    // Buscar cantidad
    const qtyMatch = line.match(/(?:^|\s)(\d{1,3})(?:\s|$)/);
    const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;

    // Intentar matchear item por nombre
    let matchedId = null;
    let maxConfidence = 0;
    
    for (const known of knownItemPatterns) {
      for (const pattern of known.patterns) {
        if (pattern.test(line)) {
          matchedId = known.id;
          maxConfidence = 1;
          break;
        }
      }
      if (matchedId) break;
    }

    // Si no matchea por nombre, buscar número al inicio de línea como ID
    if (!matchedId) {
      const idMatch = line.match(/^(\d{1,2})[\s.\-]/);
      if (idMatch) {
        const potentialId = parseInt(idMatch[1]);
        if (potentialId >= 1 && potentialId <= 19) matchedId = potentialId;
      }
    }

    if (matchedId || lastPrice > 1000) {
      extracted.push({
        description: cleanLine(line.substring(0, 60)),
        unitPrice: lastPrice,
        totalPrice: lastPrice * qty,
        qty: qty,
        matchedItemId: matchedId,
        confidence: matchedId ? 1 : 0.5,
        rawLine: cleanLine(line)
      });
    }
  });

  return extracted;
}

function detectQuality(text) {
  const t = text.toLowerCase();
  if (/schneider|abb|siemens/i.test(t)) return 'Premium';
  if (/chint.*plus|standard.plus|alta/i.test(t)) return 'Standard-Plus';
  if (/chint|standard|gen[eé]rico/i.test(t)) return 'Standard';
  return '';
}

function detectBrand(text) {
  const brands = ['ABB', 'CHINT', 'Schneider', 'Siemens', 'Genrod', 'Sica', 'Jeluz', 'Cambre', 'Phoenix'];
  const upper = text.toUpperCase();
  for (const b of brands) {
    if (upper.includes(b.toUpperCase())) return b;
  }
  return '';
}

function buildParsed(text) {
  const normalized = cleanText(text);
  const lines = normalized.split(/\n/).map(cleanLine).filter(Boolean);
  
  const proveedor = detectProvider(lines, normalized);
  const telefono = extractField(normalized, [
    /(?:tel[eé]fono|tel|whatsapp)[:\s]+([^\n]+)/i,
    /(\+?54\s?9?\s?\d[\d\s-]{7,})/i,
  ]);
  const email = extractField(normalized, [
    /(?:e-?mail|correo)[:\s]+([^\s\n]+)/i,
    /([\w.-]+@[\w.-]+\.[A-Za-z]{2,})/i,
  ]);
  const direccion = extractField(normalized, [
    /(?:domicilio|direcci[oó]n)[:\s]+([^\n]+)/i,
  ]);
  
  const marca = detectBrand(normalized) || extractField(normalized, [/marca[:\s]+([^\n]+)/i]);
  const calidad = detectQuality(normalized) || extractField(normalized, [/calidad[:\s]+([^\n]+)/i]);
  const precio = detectTotal(lines, normalized);
  const extractedItems = extractTableItems(lines, normalized);

  return {
    key: proveedor || 'proveedor',
    razonSocial: proveedor,
    nombreFantasia: proveedor,
    location: direccion,
    phone: telefono,
    email,
    itemsCotizados: extractedItems.length,
    totalItems: 17,
    faltantes: [],
    calidad,
    marca,
    precio,
    extractedItems,
    isWinner: false,
    pendientesProyecto: []
  };
}

async function tryPdfText(raw) {
  try {
    const str = raw.toString('latin1');
    const pdfStart = str.indexOf('%PDF');
    if (pdfStart === -1) return '';
    const pdfBuffer = raw.subarray(pdfStart);
    const data = await pdf(pdfBuffer);
    return cleanText(data?.text || '');
  } catch (e) {
    return '';
  }
}

async function tryOCR(raw) {
  try {
    // Para OCR, Tesseract necesita un buffer/Uint8Array de imagen
    const result = await Tesseract.recognize(raw, 'spa+eng');
    return cleanText(result?.data?.text || '');
  } catch (e) {
    return '';
  }
}

export default async function handler(req, res) {
  // CORS básico para desarrollo
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-File-Name, X-File-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, mensaje: 'function viva' });
  }

  try {
    const raw = await readRawBody(req);
    const fileType = req.headers['x-file-type'] || 'unknown';
    let text = '';
    let source = 'none';

    // Intentar PDF primero si es PDF o si no sabemos
    if (fileType === 'pdf' || raw.toString('ascii', 0, 10).includes('%PDF')) {
      try {
        text = await tryPdfText(raw);
        if (text) source = 'pdf-text';
      } catch {}
    }

    // Si no hay texto o es imagen, usar OCR
    if (!text && (fileType === 'image' || fileType === 'pdf')) {
      try {
        text = await tryOCR(raw);
        if (text) source = 'ocr';
      } catch {}
    }

    // Si es texto plano directamente
    if (!text && fileType === 'unknown') {
      try {
        text = raw.toString('utf-8');
        if (text) source = 'raw-text';
      } catch {}
    }

    const parsed = buildParsed(text);

    return res.status(200).json({
      ok: true,
      parsed,
      debug: {
        source,
        extractedChars: text.length,
        fileType
      }
    });
  } catch (error) {
    return res.status(200).json({
      ok: true,
      parsed: buildParsed(''),
      debug: {
        error: String(error.message || error)
      }
    });
  }
}
