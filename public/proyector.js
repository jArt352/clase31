// proyector.js: lo que hace la pantalla grande (proyector.html)
const $ = (id) => document.getElementById(id);

// Código QR que apunta a la página del celular
const direccion = new URL("index.html", location.href).href;
$("url").textContent = direccion;
try {
  new QRCode($("qr"), { text: direccion, width: 160, height: 160 });
} catch (e) {
  $("qr").hidden = true;
}

let lista = [];
let ultimo = "";
async function refrescar() {
  try {
    lista = await db.listar();
    const huella = JSON.stringify(lista);
    if (huella === ultimo) return;
    ultimo = huella;
    pintarMuro($("muro"), lista);
    pintarRanking($("ranking"), lista);
    $("contador").textContent = lista.length + (lista.length === 1 ? " disfraz en el concurso" : " disfraces en el concurso");
  } catch (e) {
    $("contador").textContent = mensajeError(e);
  }
}

// Pantalla final con el ganador
$("ganador").onclick = () => {
  if (!lista.length) return;
  const orden = [...lista].sort((a, b) => b.votos - a.votos);
  const g = orden[0];
  const empate = orden.filter((p) => p.votos === g.votos).length > 1;
  const foto = el("div", "foto");
  if (urlSegura(g.foto_url)) {
    const img = el("img");
    img.src = g.foto_url;
    img.alt = g.nombre;
    img.onerror = () => foto.replaceChildren(emojiPara(g.nombre));
    foto.append(img);
  } else {
    foto.textContent = emojiPara(g.nombre);
  }
  const caja = el("div");
  caja.append(el("p", "corona", "🏆"), foto, el("h2", "", g.nombre), el("p", "", g.disfraz), el("p", "", textoVotos(g.votos) + (empate ? " (hay empate)" : "")));
  $("telon").replaceChildren(caja);
  $("telon").hidden = false;
  lanzarConfeti();
};
$("telon").onclick = () => ($("telon").hidden = true);

function lanzarConfeti() {
  const c = $("confeti");
  const x = c.getContext("2d");
  c.width = innerWidth;
  c.height = innerHeight;
  c.hidden = false;
  const colores = ["#ff8a1f", "#a56bff", "#ffd23f", "#3ddc97", "#ff5e7e"];
  const piezas = Array.from({ length: 160 }, () => ({
    x: Math.random() * c.width,
    y: -20 - Math.random() * c.height * 0.5,
    r: 4 + Math.random() * 6,
    vy: 2 + Math.random() * 4,
    vx: -1.5 + Math.random() * 3,
    giro: Math.random() * 6,
    color: colores[Math.floor(Math.random() * colores.length)],
  }));
  let cuadros = 0;
  (function animar() {
    x.clearRect(0, 0, c.width, c.height);
    for (const p of piezas) {
      p.x += p.vx;
      p.y += p.vy;
      p.giro += 0.1;
      x.fillStyle = p.color;
      x.save();
      x.translate(p.x, p.y);
      x.rotate(p.giro);
      x.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6);
      x.restore();
    }
    if (++cuadros < 300) requestAnimationFrame(animar);
    else {
      x.clearRect(0, 0, c.width, c.height);
      c.hidden = true;
    }
  })();
}

refrescar();
setInterval(refrescar, 3000);
