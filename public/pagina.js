// pagina.js: lo que hace la página del celular (index.html)
const $ = (id) => document.getElementById(id);

function mostrar(texto, esError) {
  $("msg").textContent = texto;
  $("msg").className = esError ? "error" : "";
}

// Pedir la lista al servidor y dibujarla
let ultimo = "";
async function refrescar() {
  try {
    const lista = await db.listar();
    const huella = JSON.stringify(lista) + localStorage.getItem("mi_voto");
    if (huella === ultimo) return;
    ultimo = huella;
    pintarMuro($("muro"), lista, { miVoto: localStorage.getItem("mi_voto"), onVotar: votarPor });
    pintarRanking($("ranking"), lista);
  } catch (e) {
    mostrar(mensajeError(e), true);
  }
}

async function votarPor(id) {
  try {
    await votar(id);
    mostrar("¡Voto registrado!");
  } catch (e) {
    mostrar(mensajeError(e), true);
  }
  refrescar();
}

// Vista previa de la foto antes de enviar
$("foto").onchange = async () => {
  const archivo = $("foto").files[0];
  $("vista").hidden = true;
  if (!archivo) return;
  try {
    const chica = await redimensionar(archivo);
    $("vista").src = URL.createObjectURL(chica);
    $("vista").hidden = false;
    mostrar("");
  } catch (e) {
    $("foto").value = "";
    mostrar(mensajeError(e), true);
  }
};

// Enviar el formulario
$("form").onsubmit = async (ev) => {
  ev.preventDefault();
  const problema = validar($("nombre").value, $("disfraz").value);
  if (problema) return mostrar(problema, true);
  $("enviar").disabled = true;
  try {
    const archivo = $("foto").files[0];
    const foto = archivo ? await redimensionar(archivo) : null;
    await db.agregar({ nombre: $("nombre").value.trim(), disfraz: $("disfraz").value.trim(), foto });
    $("form").reset();
    $("vista").hidden = true;
    mostrar("¡Listo! Ya apareces en el muro 🎉");
  } catch (e) {
    mostrar(mensajeError(e), true);
  } finally {
    $("enviar").disabled = false;
    refrescar();
  }
};

$("nombre").oninput = $("disfraz").oninput = () => mostrar("");

refrescar();
setInterval(refrescar, 3000);
