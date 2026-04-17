import Groq from "groq-sdk";
import formidable from "formidable";
import fs from "fs";
import pdfParse from "pdf-parse";

export const config = {
  api: { bodyParser: false },
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function extractJson(text) {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;

  return cleaned.slice(first, last + 1);
}

function fallback() {
  return {
    key: "proveedor",
    razonSocial: "",
    nombreFantasia: "",
    location: "",
    phone: "",
    itemsCotizados: 0,
    totalItems: 17,
    faltantes: [],
    calidad: "",
    marca: "",
    precio: 0,
    cotiza: [],
    isWinner: false,
    pendientesProyecto: []
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, mensaje: "function viva" });
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
    if (!fileObj) return res.status(400).json({ error: "No se recibió ningún archivo" });

    const buffer = await fs.promises.readFile(fileObj.filepath);
    const parsed = await pdfParse(buffer);
    const text = (parsed.text || "").replace(/\s+/g, " ").trim().slice(0, 12000);

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: "Responde SOLO con JSON válido. Sin markdown. Sin texto extra."
        },
        {
          role: "user",
          content: `Devuelve un JSON con estas claves: key, razonSocial, nombreFantasia, location, phone, itemsCotizados, totalItems, faltantes, calidad, marca, precio, cotiza, isWinner, pendientesProyecto.\n\nTEXTO:\n${text}`
        }
      ]
    });

    const raw = completion.choices?.?.message?.content || "";
    const jsonText = extractJson(raw);

    if (!jsonText) {
      return res.status(200).json({ ok: true, parsed: fallback(), raw });
    }

    try {
      const parsedJson = JSON.parse(jsonText);
      return res.status(200).json({ ok: true, parsed: { ...fallback(), ...parsedJson }, raw });
    } catch {
      return res.status(200).json({ ok: true, parsed: fallback(), raw });
    }
  } catch (err) {
    return res.status(500).json({
      error: "Error procesando la cotización",
      detail: String(err?.message || err)
    });
  }
}
