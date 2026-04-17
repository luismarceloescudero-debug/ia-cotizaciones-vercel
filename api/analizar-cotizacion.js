import pdf from 'pdf-parse';

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

function safeNumber(v) {
  const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function extractField(text, patterns) {
  for (const rx of patterns) {
    const m = text.match(rx);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

function buildParsed(text) {
  const proveedor = extractField(text, [
    /(?:proveedor|señores|empresa)[:\s]+([^\n]+)/i,
    /(?:raz[oó]n social)[:\s]+([^\n]+)/i,
  ]);

  const telefono = extractField(text, [
    /(?:tel[eé]fono|tel|whatsapp)[:\s]+([^\n]+)/i,
    /(\+?54\s?9?\s?\d[\d\s-]{7,})/i,
  ]);

  const direccion = extractField(text, [
    /(?:domicilio|direcci[oó]n)[:\s]+([^\n]+)/i,
  ]);

  const marca = extractField(text, [
    /(?:marca|marcas)[:\s]+([^\n]+)/i,
  ]);

  const calidad = /schneider|abb|siemens|genrod|sica|jeluz|cambre|phoenix/i.test(text)
    ? 'premium / reconocida'
    : '';

  const totalMatch = text.match(/(?:total|importe total|neto final)[:\s$]*([\d\.,]+)/i);
  const precio = totalMatch ? safeNumber(totalMatch[1]) : 0;

  const lines = text
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const cotiza = [];
  for (const line of lines) {
    if (/\d/.test(line) && /\$|\d{1,3}[\.,]\d{2}/.test(line) && line.length > 8) {
      cotiza.push(line);
    }
    if (cotiza.length >= 20) break;
  }

  return {
    key: proveedor || 'proveedor',
    razonSocial: proveedor,
    nombreFantasia: proveedor,
    location: direccion,
    phone: telefono,
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, mensaje: 'function viva' });
  }

  try {
    const raw = await readRawBody(req);
    const str = raw.toString('latin1');

    const pdfStart = str.indexOf('%PDF');
    if (pdfStart === -1) {
      return res.status(200).json({ ok: true, parsed: buildParsed('') });
    }

    const pdfBuffer = raw.subarray(pdfStart);
    const data = await pdf(pdfBuffer);
    const text = (data && data.text ? data.text : '').trim();

    return res.status(200).json({
      ok: true,
      parsed: buildParsed(text),
      debug: {
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
