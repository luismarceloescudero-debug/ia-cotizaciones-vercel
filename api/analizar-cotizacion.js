import Groq from "groq-sdk";
import formidable from "formidable";
import fs from "fs";
import pdfParse from "pdf-parse";

export const config = {
  api: {
    bodyParser: false,
  },
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function safeJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```json/gi, "")
    .replace(/^```/g, "")
    .replace(/```$/g, "")
    .trim();
  return JSON.parse(cleaned);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, mensaje: "function viva" });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY no configurada" });
  }

  try {
    const form = new formidable.IncomingForm({ maxFileSize: 10 * 1024 * 1024 });

    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });

    const uploaded = files.file || files.files || Object.values(files);
    const fileObj = Array.isArray(uploaded) ? uploaded : uploaded;

    if (!fileObj) {
      return res.status(400).json({ error: "No se recibió ningún archivo" });
    }

    const buffer = await fs.promises.readFile(fileObj.filepath);
    const parsed = await pdfParse(buffer);
    const text = (parsed.text || "").replace(/\s+/g, " ").trim();

    const systemPrompt = `
Eres un analista de compras para Hormiserv.

A partir del texto de una cotización de materiales eléctricos debes devolver UN SOLO JSON válido con esta forma:
{
  "key": "string-corta-sin-espacios",
  "razonSocial": "nombre legal proveedor",
  "nombreFantasia": "nombre comercial",
  "location": "ciudad, provincia",
  "phone": "telefono o whatsapp principal",
  "itemsCotizados": numero,
  "totalItems": 17,
  "faltantes": [numeros],
  "calidad": "Premium | Standard-Plus | Standard",
  "marca": "texto corto de marcas principales",
  "precio": numeroTotalEnPesos,
  "cotiza": [numeros],
  "isWinner": false,
  "pendientesProyecto":[2]
}

Reglas:
- Considera equivalentes: relé diferencial / módulo diferencial / interruptor diferencial.
- Los kits de jabalina pueden venir desglosados; considéralos como el ítem 15.
- Si no aparece un dato, usa cadena vacía o lista vacía.
- No incluyas texto adicional ni markdown.
`.trim();

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Texto OCR del PDF:\n\n${text}\n\nDevuelve solo JSON.`,
        },
      ],
    });

    const raw = completion.choices?.?.message?.content || "";
    const data = safeJson(raw);

    if (!data.key) {
      data.key = "proveedor";
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: "Error procesando la cotización",
      detail: String(err?.message || err),
    });
  }
}
