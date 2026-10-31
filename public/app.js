// app.js: la página habla con TU servidor (la API que tú programas en server.js).
// Esta parte ya viene hecha: tú solo programas el servidor.

// Identifica este celular para que solo pueda votar una vez.
const dispositivo = (() => {
  let id = localStorage.getItem("dispositivo");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("dispositivo", id);
  }
  return id;
})();

// ---------- Validar antes de enviar ----------
function validar(nombre, disfraz) {
  nombre = (nombre || "").trim();
  disfraz = (disfraz || "").trim();
  if (nombre.length < 2 || nombre.length > 30) return "El nombre debe tener entre 2 y 30 letras";
  if (disfraz.length < 2 || disfraz.length > 30) return "El disfraz debe tener entre 2 y 30 letras";
  return null;
}

// Solo mostramos fotos que vengan de https.
function urlSegura(u) {
  return typeof u === "string" && u.startsWith("https://");
}

// ---------- Archivos: revisar y achicar la foto antes de subirla ----------
const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];

async function redimensionar(archivo, max = 480) {
  if (!TIPOS_FOTO.includes(archivo.type)) throw new Error("Solo se aceptan fotos jpg, png o webp");
  if (archivo.size > 15 * 1024 * 1024) throw new Error("La foto es demasiado grande (máximo 15 MB)");
  const bmp = await createImageBitmap(archivo);
  const escala = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(bmp.width * escala);
  lienzo.height = Math.round(bmp.height * escala);
  lienzo.getContext("2d").drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
  return new Promise((ok) => lienzo.toBlob(ok, "image/jpeg", 0.8));
}

// ---------- Hablar con la API ----------
async function pedir(ruta, opciones) {
  let r;
  try {
    r = await fetch(ruta, opciones);
  } catch (e) {
    throw new Error("No hay conexión con el servidor");
  }
  if (!r.ok) {
    let mensaje = "";
    try {
      mensaje = (await r.json()).error || "";
    } catch (e) {}
    if (!mensaje && r.status === 404) mensaje = "Esa ruta todavía no existe en tu servidor (404)";
    throw new Error(mensaje || "El servidor respondió con error " + r.status);
  }
  return r.json();
}

const db = {
  // GET /api/participantes: ver el menú
  listar: () => pedir("/api/participantes"),

  // 1) Si hay foto: POST /api/fotos (paso 5). El servidor la guarda y devuelve su dirección.
  // 2) POST /api/participantes: hacer un pedido nuevo (paso 2).
  async agregar({ nombre, disfraz, foto }) {
    let foto_url = null;
    if (foto) {
      const datos = new FormData();
      datos.append("foto", foto, "foto.jpg");
      foto_url = (await pedir("/api/fotos", { method: "POST", body: datos })).url;
    }
    await pedir("/api/participantes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nombre, disfraz, foto_url }),
    });
  },

  // POST /api/participantes/:id/votar
  votar: (id) => pedir("/api/participantes/" + id + "/votar", { method: "POST", headers: { "x-dispositivo": dispositivo } }),
};

async function votar(id) {
  await db.votar(id);
  localStorage.setItem("mi_voto", id);
}

function mensajeError(e) {
  return (e && e.message) || String(e);
}

// ---------- Dibujar tarjetas y ranking ----------
// Usamos textContent (nunca innerHTML) para que un nombre con <script> no pueda hacer daño.
function el(etiqueta, clase, texto) {
  const e = document.createElement(etiqueta);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

const EMOJIS = ["👻", "🎃", "🦇", "🧙", "🧛", "🧟", "💀", "🕷️"];
function emojiPara(nombre) {
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) % 997;
  return EMOJIS[h % EMOJIS.length];
}

function textoVotos(n) {
  return n + (n === 1 ? " voto" : " votos");
}

function crearTarjeta(p, { miVoto, onVotar } = {}) {
  const tarjeta = el("article", "tarjeta");
  const foto = el("div", "foto");
  if (urlSegura(p.foto_url)) {
    const img = el("img");
    img.src = p.foto_url;
    img.alt = "Disfraz de " + p.nombre;
    img.onerror = () => foto.replaceChildren(emojiPara(p.nombre)); // si la foto no carga, mostramos un emoji
    foto.append(img);
  } else {
    foto.textContent = emojiPara(p.nombre);
  }
  tarjeta.append(foto, el("h3", "", p.nombre), el("p", "disfraz", p.disfraz), el("p", "votos", textoVotos(p.votos)));
  if (onVotar) {
    const boton = el("button", miVoto === p.id ? "mio" : "", miVoto === p.id ? "Tu voto" : "Votar");
    boton.disabled = Boolean(miVoto);
    boton.onclick = () => onVotar(p.id);
    tarjeta.append(boton);
  }
  return tarjeta;
}

const yaVistos = new Set();
function pintarMuro(contenedor, lista, opciones) {
  contenedor.replaceChildren();
  for (const p of lista) {
    const tarjeta = crearTarjeta(p, opciones);
    if (!yaVistos.has(p.id)) tarjeta.classList.add("nuevo");
    yaVistos.add(p.id);
    contenedor.append(tarjeta);
  }
  if (lista.length === 0) contenedor.append(el("p", "nota", "Aún no hay disfraces. Sé la primera persona."));
}

function pintarRanking(contenedor, lista) {
  const top = [...lista].sort((a, b) => b.votos - a.votos).slice(0, 5);
  const max = Math.max(1, top.length ? top[0].votos : 1);
  contenedor.replaceChildren();
  top.forEach((p, i) => {
    const barra = el("i");
    const pista = el("div", "barra");
    pista.append(barra);
    const fila = el("div", "fila");
    fila.append(el("span", "pos", String(i + 1)), el("span", "quien", p.nombre), pista, el("span", "n", String(p.votos)));
    contenedor.append(fila);
    requestAnimationFrame(() => requestAnimationFrame(() => (barra.style.width = Math.round((p.votos / max) * 100) + "%")));
  });
}
