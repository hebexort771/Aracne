<p align="center">
  <img src="build/icon.png" width="120" alt="Icono de Aracne">
</p>

<h1 align="center">Aracne</h1>

<p align="center">
  <b>Arañas digitales que leen contigo.</b><br>
  Pulsa <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Espacio</kbd> (en Mac <kbd>⌘</kbd> + <kbd>⇧</kbd> + <kbd>Espacio</kbd>) sobre cualquier página, PDF o documento<br>
  y unas arañas saldrán de un agujero negro a leer todo el documento, renglón por renglón, bajando la página solas:<br>
  verifican fuentes, encuentran plazos, cifras y nombres, resumen, explican imágenes y te ayudan a estudiar.
</p>

<p align="center">
  <a href="https://hebexort771.github.io/Aracne/"><b>Página web</b></a> ·
  <a href="../../releases/latest"><b>Descargar</b></a> ·
  Gratis para Windows, Mac y Linux
</p>

---

## Descargar

| Sistema | Instalador |
|---|---|
| Mac con chip M (M1, M2, M3, M4…) | [`Aracne-mac-arm64.dmg`](../../releases/latest/download/Aracne-mac-arm64.dmg) |
| Mac con Intel | [`Aracne-mac-x64.dmg`](../../releases/latest/download/Aracne-mac-x64.dmg) |
| Windows 10 / 11 | [`Aracne-windows-x64.exe`](../../releases/latest/download/Aracne-windows-x64.exe) |
| Linux | [`Aracne-linux-x86_64.AppImage`](../../releases/latest/download/Aracne-linux-x86_64.AppImage) · [`.deb`](../../releases/latest/download/Aracne-linux-amd64.deb) |

La app todavía no está firmada por Apple ni por Microsoft, así que la primera vez:

- **Mac:** si dice que no puede comprobarla → *Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente*. Para usar el atajo, activa Aracne en *Grabación de pantalla* y reinicia la app. Para que las arañas bajen la página solas, actívala también en *Accesibilidad* (como la app no está firmada, puede que tengas que volver a darle estos permisos después de cada actualización).
- **Windows:** si aparece "Windows protegió tu PC" → *Más información → Ejecutar de todas formas*.
- **Linux:** da permiso de ejecución al `.AppImage` (clic derecho → Propiedades).

## Qué hace

Cada araña tiene un trabajo:

| Araña | Qué hace | ¿Necesita IA? |
|---|---|---|
| **Fuentes** | Revisa DOI, ISBN, PubMed, PMC, arXiv y enlaces. Detecta artículos **retractados**, DOI inventados y enlaces rotos (con copia en archive.org). Copia tu bibliografía en **APA 7**. | No |
| **Plazos** | Encuentra exámenes, entregas, pagos e inscripciones y los manda a Google Calendar o a un archivo `.ics`. | No |
| **Contexto** | Al pasar el cursor sobre "Figura 3", "[12]", una nota o una sigla, una araña te trae lo que menciona. | No |
| **Datos** | Encuentra cifras (montos, porcentajes, medidas), personas, lugares e instituciones, definiciones, citas textuales, correos y teléfonos en cualquier texto. | No |
| **Memoria** | Recuerda lo que lees (solo en tu computadora) y te muestra conexiones con lecturas anteriores. | No |
| **Lectura** | Tiempo de lectura, nivel de dificultad (INFLESZ / Flesch), oraciones más difíciles y modo enfoque. | No |
| **Resumen** | Ideas clave, secciones, glosario y preguntas de repaso; cada idea tiene un hilo al párrafo de donde sale. Sin IA hace un resumen extractivo. | Sí (opcional) |
| **Preguntar** | Preguntas sobre el documento con respuestas que citan los párrafos. | Sí |
| **Estudiar** | Tarjetas de memoria y quiz tipo examen, exportables a Anki. | Sí |
| **Visión** | La **lupa araña**: encierra un gráfico, una fórmula (la escribe en LaTeX), una tabla o una foto y te la explica. Sin IA, copia el texto de la zona con OCR. | Sí (opcional) |
| **Letra pequeña** | Marca las trampas de contratos, matrículas y suscripciones. | Sí |

### Cómo trabajan las arañas

1. **Salen de un agujero negro.** Al pulsar el atajo se abre un agujero en el centro, la pantalla se oscurece poco a poco como tinta y las arañas salen de un saltito, una por una.
2. **Leen todo, renglón por renglón.** Cada palabra que pasan se enciende y se decodifica; lo que encuentran (fechas, fuentes, cifras, nombres…) se marca y vuela como un paquete de datos a la burbujita.
3. **Bajan la página solas.** Cuando terminan lo que se ve, giran la rueda del mouse en tu aplicación (Chrome, el visor de PDF, Word…), leen lo nuevo y siguen hasta el final del documento.
4. **Enmarcar.** Con el botón *Enmarcar* dibujas un recuadro y solo escanean esa parte.
5. **Vuelven a esconderse.** Al terminar caminan hasta el agujero, se despiden con una patita, se meten girando y la pantalla vuelve a la normalidad. Lo que encontraron queda en una **burbujita**: tócala para abrir el panel y ocúltalo con » cuando quieras seguir leyendo.

`Esc` (o el atajo otra vez) las manda de vuelta al agujero antes de terminar. En el lector funciona igual: escanean todo el documento bajando solas, puedes enmarcar una parte y ocultar el panel.

- **Mac:** para bajar la página en otras aplicaciones necesitan el permiso de *Accesibilidad* (Aracne lo pide la primera vez).
- **Linux:** funciona en sesiones X11. En Wayland leen solo lo que se ve.
- En *Ajustes → Animación* eliges la intensidad (Alta, Media, Baja o sin arañas) y si deben bajar la página solas.

### Dos formas de usarla

1. **Sobre cualquier aplicación** con el atajo: toma una captura, la oscurece desde el agujero negro, la lee con OCR en tu computadora y las arañas recorren todo el documento. `Esc` para terminar antes.
2. **En el lector**: pega un enlace o arrastra un PDF, Word (`.docx`), imagen, `.txt`, `.md` o `.html`.

### IA gratis

- **Ollama** (en tu computadora, sin internet): instala [Ollama](https://ollama.com/download) y ejecuta `ollama pull gemma3`. Aracne lo detecta solo.
- **Google Gemini** (gratis con límites): crea una clave en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) y pégala en *Ajustes*.
- También funciona con **Claude**, **OpenAI** y servicios compatibles (Groq, OpenRouter, LM Studio…).

Las claves se guardan cifradas en tu computadora.

## Privacidad

El OCR, la búsqueda de fechas, siglas y referencias, y la memoria funcionan sin internet. Para verificar fuentes, Aracne consulta catálogos abiertos (Crossref, DataCite, PubMed, arXiv, Open Library, Google Books y archive.org) solo con los identificadores que encuentra. Si usas una IA en la nube, solo se envía el texto o la imagen que pides analizar.

---

## Para desarrolladores

Requiere Node.js 22.

```bash
npm install
npm run dev        # Vite + Electron con recarga
npm test           # pruebas de los extractores (fechas, fuentes, APA, lectura…)
npm run dist       # instaladores para tu sistema en release/
```

### Estructura

```
electron/            proceso principal
  main.js            ventanas, atajo global, bandeja, captura de pantalla, burbuja, IPC
  input.js           gira la rueda del mouse en otras apps (@jitsi/robotjs) para bajar la página
  ai.js              Ollama, Gemini, Claude, OpenAI/compatibles
  sources.js         verificación de DOI/ISBN/PubMed/arXiv/enlaces
  memory.js          memoria de lecturas (local)
  settings.js        ajustes; claves cifradas con safeStorage
  web.js             carga páginas web completas (incluye las que usan JavaScript)
src/
  spiders/engine.js  motor de arañas: patas con cinemática inversa, lectura por renglones, agujero negro, seda, recuadros neón
  core/              extractores sin IA (fuentes, fechas, siglas, referencias, cifras, nombres, definiciones), APA 7, .ics, OCR,
                     documento de pantalla de varias páginas y medición del desplazamiento entre capturas
  ai/tasks.js        resumen con párrafos citados, preguntas, estudio, visión, letra pequeña
  panel/panel.js     panel lateral (compartido por el lector y la capa de pantalla)
  lector/            lector de web, PDF (pdf.js), Word (mammoth), texto e imágenes
  overlay/           capa que aparece con el atajo
docs/                página web (GitHub Pages)
.github/workflows/   compila los instaladores al publicar una versión
```

### Publicar una versión

1. Sube los cambios a `main`.
2. En GitHub → **Releases → Draft a new release** → etiqueta `v1.2.1` (o la que siga) → **Publish release**.
3. GitHub Actions compila Mac, Windows y Linux (unos 15 minutos) y adjunta los instaladores.

## Licencia

[MIT](LICENSE) © 2026 Heber Gomez
