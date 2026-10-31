
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const helmet = require("helmet");
const cors = require("cors");
const multer = require("multer");
const { rateLimit } = require("express-rate-limit");

// ========================================
// 1. VARIABLES DE ENTORNO
// ========================================

require("dotenv").config({
  path: path.join(__dirname, ".env"),
  quiet: true
});

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = (
  process.env.SUPABASE_URL || ""
).trim().replace(/\/+$/, "");

const SUPABASE_KEY = (
  process.env.SUPABASE_KEY || ""
).trim();

const BUCKET = "disfraces";

// ========================================
// 2. CONFIGURACIÓN GENERAL
// ========================================

app.set("trust proxy", 1);
app.disable("x-powered-by");

// ========================================
// 3. SEGURIDAD HELMET
// ========================================

const imagenesPermitidas = [
  "'self'",
  "data:",
  "blob:"
];

if (SUPABASE_URL) {
  try {
    imagenesPermitidas.push(
      new URL(SUPABASE_URL).origin
    );
  } catch (error) {
    console.error("SUPABASE_URL no es válida");
  }
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "script-src": [
          "'self'",
          "https://cdnjs.cloudflare.com"
        ],
        "img-src": imagenesPermitidas,
        "upgrade-insecure-requests": null
      }
    }
  })
);

// ========================================
// 4. CONFIGURACIÓN CORS
// ========================================

const origenPermitido = process.env.ORIGEN_PERMITIDO;

if (origenPermitido) {
  app.use("/api", cors({
    origin: origenPermitido
  }));
}

// ========================================
// 5. LIMITAR PETICIONES
// ========================================

const mensajeLimite = {
  error: "Vas muy rápido. Espera un momento y vuelve a intentarlo"
};

const limiteGeneral = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json(mensajeLimite);
  }
});

const limitePost = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json(mensajeLimite);
  }
});

app.use("/api", limiteGeneral);

app.use("/api", (req, res, next) => {
  if (req.method === "POST") {
    return limitePost(req, res, next);
  }

  next();
});

// ========================================
// 6. RECIBIR JSON
// ========================================

app.use(express.json({
  limit: "10kb"
}));

// ========================================
// 7. VERIFICAR SUPABASE
// ========================================

function verificarSupabase(req, res, next) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({
      error: "Falta configurar SUPABASE_URL y SUPABASE_KEY"
    });
  }

  next();
}

// ========================================
// 8. MANEJAR FUNCIONES ASYNC
// ========================================

function asyncHandler(funcion) {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => funcion(req, res, next))
      .catch(next);
  };
}

// ========================================
// 9. HEADERS PARA SUPABASE
// ========================================

function headersSupabase() {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`
  };
}

// ========================================
// 10. PETICIONES A SUPABASE
// ========================================

// Función común para consultas REST,
// inserciones y llamadas RPC.
async function consultarSupabase(ruta, opciones = {}) {
  const respuesta = await fetch(
    `${SUPABASE_URL}${ruta}`,
    {
      ...opciones,
      headers: {
        ...headersSupabase(),
        "Content-Type": "application/json",
        ...(opciones.headers || {})
      },
      signal: AbortSignal.timeout(20000)
    }
  );

  const texto = await respuesta.text();

  // Si Supabase devuelve un error
  if (!respuesta.ok) {
    let detalle;

    try {
      detalle = JSON.parse(texto);
    } catch (error) {
      detalle = { message: texto };
    }

    // Conservar el detalle para el servidor
    const fallo = new Error(
      "La petición a Supabase falló"
    );

    fallo.esSupabase = true;
    fallo.estadoSupabase = respuesta.status;
    fallo.detalleSupabase = detalle;

    throw fallo;
  }

  // Algunas funciones RPC no devuelven datos
  if (!texto) {
    return null;
  }

  return JSON.parse(texto);
}

// ========================================
// 11. CONFIGURACIÓN DE MULTER
// ========================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1
  }
});

// ========================================
// 12. DETECTAR TIPO REAL DE IMAGEN
// ========================================

function detectarImagen(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return null;
  }

  // JPEG: FF D8 FF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return {
      mime: "image/jpeg",
      extension: "jpg"
    };
  }

  // PNG
  const firmaPng = Buffer.from([
    0x89, 0x50, 0x4e, 0x47,
    0x0d, 0x0a, 0x1a, 0x0a
  ]);

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(firmaPng)
  ) {
    return {
      mime: "image/png",
      extension: "png"
    };
  }

  // WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return {
      mime: "image/webp",
      extension: "webp"
    };
  }

  return null;
}

// ========================================
// 13. VALIDAR FOTO_URL
// ========================================

function fotoUrlValida(fotoUrl) {
  if (fotoUrl === undefined || fotoUrl === null) {
    return true;
  }

  if (typeof fotoUrl !== "string") {
    return false;
  }

  const prefijo =
    `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

  if (!fotoUrl.startsWith(prefijo)) {
    return false;
  }

  const nombreArchivo = fotoUrl.slice(prefijo.length);

  const regexFoto =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

  return regexFoto.test(nombreArchivo);
}

// ========================================
// 14. VALIDAR UUID
// ========================================

function uuidValido(id) {
  const regex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  return typeof id === "string" && regex.test(id);
}

// ========================================
// 15. GET /api/participantes
// ========================================

app.get(
  "/api/participantes",
  verificarSupabase,
  asyncHandler(async (req, res) => {
    const datos = await consultarSupabase(
      "/rest/v1/participantes?select=*&order=creado_en.desc"
    );

    res.status(200).json(datos);
  })
);

// ========================================
// 16. POST /api/participantes
// ========================================

app.post(
  "/api/participantes",
  verificarSupabase,
  asyncHandler(async (req, res) => {
    const {
      nombre,
      disfraz,
      foto_url
    } = req.body || {};

    if (
      typeof nombre !== "string" ||
      nombre.trim().length < 2 ||
      nombre.trim().length > 30
    ) {
      return res.status(400).json({
        error: "El nombre debe tener entre 2 y 30 caracteres"
      });
    }

    if (
      typeof disfraz !== "string" ||
      disfraz.trim().length < 2 ||
      disfraz.trim().length > 30
    ) {
      return res.status(400).json({
        error: "El disfraz debe tener entre 2 y 30 caracteres"
      });
    }

    if (!fotoUrlValida(foto_url)) {
      return res.status(400).json({
        error: "La foto no es válida"
      });
    }

    const nuevoParticipante = {
      nombre: nombre.trim(),
      disfraz: disfraz.trim(),
      foto_url: foto_url || null
    };

    const datos = await consultarSupabase(
      "/rest/v1/participantes",
      {
        method: "POST",
        headers: {
          Prefer: "return=representation"
        },
        body: JSON.stringify(nuevoParticipante)
      }
    );

    if (!Array.isArray(datos) || !datos[0]) {
      throw new Error(
        "Supabase no devolvió el participante creado"
      );
    }

    res.status(201).json(datos[0]);
  })
);

// ========================================
// 17. GET /api/participantes/:id
// ========================================

app.get(
  "/api/participantes/:id",
  verificarSupabase,
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (!uuidValido(id)) {
      return res.status(400).json({
        error: "El ID debe ser un UUID válido"
      });
    }

    const datos = await consultarSupabase(
      `/rest/v1/participantes?select=*&id=eq.${id}`
    );

    if (!Array.isArray(datos) || datos.length === 0) {
      return res.status(404).json({
        error: "Ese participante no existe"
      });
    }

    res.status(200).json(datos[0]);
  })
);

// ========================================
// 18. POST /api/fotos
// ========================================

app.post(
  "/api/fotos",
  verificarSupabase,

  (req, res, next) => {
    if (!req.is("multipart/form-data")) {
      return res.status(400).json({
        error: "Debes enviar la foto como formulario"
      });
    }

    next();
  },

  upload.single("foto"),

  asyncHandler(async (req, res) => {
    const archivo = req.file;

    if (!archivo) {
      return res.status(400).json({
        error: "Debes enviar una foto"
      });
    }

    const tiposPermitidos = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!tiposPermitidos.includes(archivo.mimetype)) {
      return res.status(400).json({
        error: "Solo se aceptan fotos jpg, png o webp"
      });
    }

    const tipoReal = detectarImagen(archivo.buffer);

    if (
      !tipoReal ||
      tipoReal.mime !== archivo.mimetype
    ) {
      return res.status(400).json({
        error: "El archivo no es una imagen real"
      });
    }

    const nombreArchivo =
      `${crypto.randomUUID()}.${tipoReal.extension}`;

    const rutaStorage =
      `/storage/v1/object/${BUCKET}/${nombreArchivo}`;

    // Enviar fotografía a Supabase Storage
    const respuesta = await fetch(
      `${SUPABASE_URL}${rutaStorage}`,
      {
        method: "POST",
        headers: {
          ...headersSupabase(),
          "Content-Type": tipoReal.mime
        },
        body: archivo.buffer,
        signal: AbortSignal.timeout(20000)
      }
    );

    if (!respuesta.ok) {
      const detalle = await respuesta.text();

      console.error(
        "Error Storage Supabase:",
        respuesta.status,
        detalle
      );

      throw new Error(
        "No se pudo subir la fotografía"
      );
    }

    const fotoPublica =
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${nombreArchivo}`;

    res.status(201).json({
      url: fotoPublica
    });
  })
);

// ========================================
// 19. POST /api/participantes/:id/votar
// ========================================

app.post(
  "/api/participantes/:id/votar",
  verificarSupabase,

  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Leer identificador del dispositivo
    const encabezado = req.get("x-dispositivo");

    const dispositivo =
      typeof encabezado === "string"
        ? encabezado.trim()
        : "";

    // Validar dispositivo
    if (
      dispositivo.length < 8 ||
      dispositivo.length > 64
    ) {
      return res.status(400).json({
        error: "Dispositivo no válido"
      });
    }

    // Validar ID del participante
    if (!uuidValido(id)) {
      return res.status(404).json({
        error: "Ese participante no existe"
      });
    }

    // Llamar a la función votar de Supabase
    try {
      await consultarSupabase(
        "/rest/v1/rpc/votar",
        {
          method: "POST",
          body: JSON.stringify({
            p_id: id,
            p_dispositivo: dispositivo
          })
        }
      );
    } catch (error) {
      // Leer el mensaje enviado por PostgreSQL
      const mensaje = error.esSupabase
        ? error.detalleSupabase?.message
        : null;

      // Este dispositivo ya votó
      if (mensaje === "Ya votaste") {
        return res.status(409).json({
          error: "Ya votaste"
        });
      }

      // El participante no existe
      if (mensaje === "Ese disfraz no existe") {
        return res.status(404).json({
          error: "Ese participante no existe"
        });
      }

      // Cualquier otro error pasa al manejador final
      throw error;
    }

    // Consultar el participante ya actualizado
    const datos = await consultarSupabase(
      `/rest/v1/participantes?select=*&id=eq.${id}`
    );

    if (!Array.isArray(datos) || datos.length === 0) {
      return res.status(404).json({
        error: "Ese participante no existe"
      });
    }

    // Devolver participante con votos actualizados
    res.status(200).json(datos[0]);
  })
);

// ========================================
// 20. GET /api/ranking
// ========================================

app.get(
  "/api/ranking",
  verificarSupabase,

  asyncHandler(async (req, res) => {
    const ranking = await consultarSupabase(
      "/rest/v1/participantes?select=*&order=votos.desc&limit=5"
    );

    res.status(200).json(ranking);
  })
);

// ========================================
// 21. RUTAS API INEXISTENTES
// ========================================

app.use("/api", (req, res) => {
  console.warn(
    "Ruta API no encontrada:",
    req.method,
    req.originalUrl
  );

  res.status(404).json({
    error: "Ruta no encontrada"
  });
});

// ========================================
// 22. MOSTRAR LA PÁGINA EXISTENTE
// ========================================

app.use(
  express.static(path.join(__dirname, "public"))
);

// ========================================
// 23. MANEJADOR FINAL DE ERRORES
// ========================================

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  // Errores de Multer
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: "La foto pesa más de 2 MB"
      });
    }

    return res.status(400).json({
      error: "No se pudo procesar la fotografía"
    });
  }

  // JSON demasiado grande
  if (
    err.type === "entity.too.large" ||
    err.status === 413
  ) {
    return res.status(413).json({
      error: "El mensaje es demasiado grande"
    });
  }

  // JSON inválido
  if (err.status === 400) {
    return res.status(400).json({
      error: "La solicitud contiene datos inválidos"
    });
  }

  // Errores de Supabase: mostrar detalle solo
  // en la terminal, nunca al visitante
  if (err.esSupabase) {
    console.error(
      "Error de Supabase:",
      err.estadoSupabase,
      err.detalleSupabase
    );
  } else {
    console.error("Error interno:", err);
  }

  res.status(500).json({
    error: "Algo salió mal en el servidor"
  });
});

// ========================================
// 24. INICIAR Y EXPORTAR SERVIDOR
// ========================================

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `Servidor funcionando en http://localhost:${PORT}`
    );
  });
}

module.exports = app;
