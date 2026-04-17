export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, mensaje: "function viva" });
  }

  return res.status(200).json({
    ok: true,
    parsed: {
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
    }
  });
}
