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
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'));
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
  ]);
  if (direct) return direct;

  const likely = lines.find(l =>
    /s\.r\.l|srl|s\.a\.|sa\b|sociedad|electric|electro|ferreter|materiales|industrial|servicios/i.test(l)
  );
  return likely || '';
}

function detectTotal(lines, text) {
  const candidates = [
    ...lines.filter(l => /total\b|importe total|neto final|total final/i.test(l)),
  ];

  for (const line of candidates) {
    const m = line.match(/([\d.]+[,\.]\d{2}|\d+)/g);
    if (m && m.length) {
      return safeNumber(m[m.length - 1]);
    }
  }

  const fallback = text.match(/(?:total|importe total|neto final)[:\s$]*([\d\.,]+)/i);
  return fallback ? safeNumber(fallback[1]) : 0;
}

function collectQuoteLines(lines) {
  const out = [];
  const skip = /^(condici[oó]n|e-?mail|correo|iva|neto|subtotal|total|fecha|p[aá]g|observ|codigo|c[oó]digo|lista|plazo|validez|contacto|telefono|tel|whatsapp|cliente|cuit|direccion|domicilio)[:\s-]*$/i;

  for (const line of lines) {
    const hasMoney = /\$/.test(line) || /\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})/.test(line);
    const longEnough = line.length > 8;
    const noisy = /^[-=_\s]+$/.test(line) || skip.test(line);

    if (hasMoney && longEnough && !noisy) {
      out.push(line);
    }
    if (out.length >= 20) break;
  }
  return out;
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

  const marca = extractField(normalized, [
    /(?:marca|marcas)[:\s]+([^\n]+)/i,
  ]);

  const calidad = /schneider|abb|siemens|genrod|sica|jeluz|cambre|phoenix/i.test(normalized)
    ? 'premium / reconocida'
    : '';

  const precio = detectTotal(lines, normalized);
  const cotiza = collectQuoteLines(lines);

  return {
    key: proveedor || 'proveedor',
    razonSocial: proveedor,
    nombreFantasia: proveedor,
    location: direccion,
    phone: telefono,
    email,
    itemsCotizados: cotiza.length,
    totalItems: 17,
    faltantes: [],
    calidad,
    marca,
    precio,
    cotiza,
    isWinner: false,
    pendientesProyecto: []
  };
}

async function tryPdfText(raw) {
  const str = raw.toString('latin1');
  const pdfStart = str.indexOf('%PDF');
  if (pdfStart === -1) return '';
  const pdfBuffer = raw.subarray(pdfStart);
  const data = await pdf(pdfBuffer);
  return cleanText(data?.text || '');
}

async function tryOCR(raw) {
  const result = await Tesseract.recognize(raw, 'spa+eng');
  return cleanText(result?.data?.text || '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, mensaje: 'function viva' });
  }

  try {
    const raw = await readRawBody(req);
    let text = '';
    let source = 'none';

    try {
      text = await tryPdfText(raw);
      if (text) source = 'pdf-text';
    } catch {}

    if (!text) {
      try {
        text = await tryOCR(raw);
        if (text) source = 'ocr';
      } catch {}
    }

    return res.status(200).json({
      ok: true,
      parsed: buildParsed(text),
      debug: {
        source,
        extractedChars: text.length
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
