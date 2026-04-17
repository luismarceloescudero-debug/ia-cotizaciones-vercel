import Groq from "groq-sdk";
import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false,
  },
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY no configurada en variables de entorno" });
  }

  try {
    const form = new formidable.IncomingForm({ maxFileSize: 5 * 1024 * 1024 }); // 5MB

    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ fields, files });
      });
    });

    const uploaded = files.file || files.files || Object.values(files)[0];
    const fileObj = Array.isArray(uploaded) ? uploaded[0] : uploaded;

    if (!fileObj) {
      return res.status(400).json({ error: "No se recibió ningún archivo" });
    }

    const buffer = await fs.promises.readFile(fileObj.filepath);
    const base64 = buffer.toString("base64");

    const systemPrompt = `Eres un analista de compras para Hormiserv.

A partir de una cotización de materiales eléctricos (en PDF, codificada en base64) debes mapear los renglones a este listado normalizado de ítems (1 a 19):

1. Prensacable 2"
2. Prensacable 1"
3. Prensacable 3/4"
4. Riel DIN 1m
5. Terminal bimetálico 150mm
6. Terminal bimetálico 70mm
7. Interruptor 4x200A regulable (140-200A)
8. Interruptor 4x160A regulable (112-160A)
9. Módulo / relé / interruptor diferencial acoplado
10. Gabinete metálico alrededor de 700x600 IP65 con contratapa/contrafrente
11. Barra / distribuidor tetrapolar 250A
12. Cable unipolar 70mm² Cu (por metro)
13. Terminal de cobre 70mm²
14. Bandeja portacable 200mm con tapa (3m)
15. Kit jabalina 3/4" x 1,5m con caja, gel, tomacable, etc.
16. Bobina Cable unipolar 4mm² (100m)
17. Terminal ojal cobre 4mm²
18. Smart Energy Controller BGH SPC01 (limitador de inyección)
19. Cable UTP CAT 6 EXTERIOR COBRE (150m)

Reglas:
- Considera equivalentes: relé diferencial / módulo diferencial / interruptor diferencial.
- Los kits de jabalina pueden venir desglosados (jabalina + caja + gel + tomacable); considéralos como el mismo ítem 15.
- Si el proveedor cotiza TODOS los 1..17, pero no aparecen 18 y 19, entiende que faltan solo los ítems globales del proyecto (18 y 19).

Debes devolver UN SOLO objeto JSON con esta forma:
{
  "key": "string-corta-sin-espacios",
  "razonSocial": "nombre legal proveedor",
  "nombreFantasia": "nombre comercial",
  "location": "ciudad, provincia",
  "phone": "telefono o whatsapp principal",
  "itemsCotizados": numero,
  "totalItems": 17,
  "faltantes": [lista de numeros de items faltantes entre 1 y 17],
  "calidad": "Premium | Standard-Plus | Standard",
  "marca": "texto corto de marcas principales (ABB / CHINT / etc.)",
  "precio": numeroTotalEnPesos,
  "cotiza": [lista de numeros de items cotizados entre 1 y 17],
  "isWinner": false,
  "pendientesProyecto": [lista de items 18 y/o 19 que falten]
}

No incluyas texto adicional ni comentarios, solo JSON válido.`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            "Cotización en PDF codificada en base64:
" +
            base64 +
            "

Extrae la información y responde solo con el JSON solicitado.",
        },
      ],
      temperature: 0.2,
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      return res.status(500).json({ error: "Respuesta vacía desde Groq" });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // intentar limpiar código de bloque si viene envuelto en ```json
      const cleaned = text.replace(/^```json/gi, "").replace(/```$/g, "").trim();
      data = JSON.parse(cleaned);
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error procesando la cotización" });
  }
}
