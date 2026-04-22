import { FFmpeg } from "./vendor/ffmpeg/index.js";

const FFMPEG_CORE_URL = new URL("./vendor/ffmpeg-core/ffmpeg-core.js", import.meta.url).href;
const FFMPEG_WASM_URL = new URL("./vendor/ffmpeg-core/ffmpeg-core.wasm", import.meta.url).href;

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const filePill = document.getElementById("file-pill");
const workspace = document.getElementById("workspace");
const formatSelect = document.getElementById("format-select");
const convertBtn = document.getElementById("convert-btn");
const downloadLink = document.getElementById("download-link");
const advancedContent = document.getElementById("advanced-content");
const sourcePreview = document.getElementById("source-preview");
const outputPreview = document.getElementById("output-preview");
const statusEl = document.getElementById("status");

const ffmpegState = { instance: null, loaded: false, loadingPromise: null, busy: false };
const appState = {
  file: null,
  fileType: null,
  sourceUrl: null,
  outputUrl: null,
  sourceWidth: null,
  sourceHeight: null,
};

const AUDIO_FORMATS = [
  { value: "mp3", label: "MP3" },
  { value: "wav", label: "WAV" },
  { value: "ogg", label: "OGG" },
  { value: "aac", label: "AAC (.m4a)" },
  { value: "flac", label: "FLAC" },
];

const IMAGE_FORMATS = [
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
  { value: "webp", label: "WEBP" },
];

function detectFileType(file) {
  if (file.type.startsWith("audio/") || /\.(mp3|wav|ogg|flac|aac|m4a|webm)$/i.test(file.name)) {
    return "audio";
  }

  if (file.type.startsWith("image/") || /\.(png|jpg|jpeg|gif|bmp|webp|tif|tiff|avif)$/i.test(file.name)) {
    return "image";
  }

  return null;
}

function setStatus(message, tone = "neutral") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function formatFileSize(bytes) {
  if (!bytes) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / 1024 ** exp;
  return `${val.toFixed(val >= 10 || exp === 0 ? 0 : 1)} ${units[exp]}`;
}

function safeBaseName(name) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-_]+/gi, "-")
    .replace(/-+/g, "-");
}

function populateFormats(type) {
  const formats = type === "audio" ? AUDIO_FORMATS : IMAGE_FORMATS;
  formatSelect.innerHTML = formats.map((format) => `<option value="${format.value}">${format.label}</option>`).join("");

  if (type === "audio") {
    const ext = appState.file.name.split(".").pop().toLowerCase();
    const suggestions = {
      wav: "mp3",
      mp3: "wav",
      ogg: "mp3",
      flac: "wav",
      aac: "mp3",
      m4a: "mp3",
      webm: "mp3",
    };
    formatSelect.value = suggestions[ext] ?? "mp3";
  }
}

function buildAudioSettings() {
  advancedContent.innerHTML = `
    <div class="settings-content">
      <label class="control">
        <span>Bitrate</span>
        <select id="audio-bitrate">
          <option value="128k">128 kbps</option>
          <option value="192k" selected>192 kbps</option>
          <option value="256k">256 kbps</option>
          <option value="320k">320 kbps</option>
        </select>
      </label>
      <label class="control">
        <span>Sample rate</span>
        <select id="audio-sample-rate">
          <option value="keep">Keep source</option>
          <option value="44100">44.1 kHz</option>
          <option value="48000">48 kHz</option>
        </select>
      </label>
    </div>
  `;
}

function buildImageSettings() {
  advancedContent.innerHTML = `
    <div class="settings-content">
      <label class="control">
        <span>Width</span>
        <input id="image-width" type="number" min="1" placeholder="Original" />
      </label>
      <label class="control">
        <span>Height</span>
        <input id="image-height" type="number" min="1" placeholder="Original" />
      </label>
      <label class="control">
        <span>Rotation</span>
        <select id="image-rotation">
          <option value="0">0°</option>
          <option value="90">90°</option>
          <option value="180">180°</option>
          <option value="270">270°</option>
        </select>
      </label>
      <label class="control">
        <span>Quality</span>
        <div class="range-control">
          <input id="image-quality" type="range" min="40" max="100" value="88" />
          <strong id="image-quality-value">88</strong>
        </div>
      </label>
      <label class="control">
        <span>Brightness</span>
        <div class="range-control">
          <input id="image-brightness" type="range" min="50" max="150" value="100" />
          <strong id="image-brightness-value">100%</strong>
        </div>
      </label>
    </div>
    <div class="settings-toggles">
      <label class="toggle"><input id="keep-aspect" type="checkbox" checked /><span>Keep aspect ratio</span></label>
      <label class="toggle"><input id="image-flip-h" type="checkbox" /><span>Flip horizontal</span></label>
      <label class="toggle"><input id="image-flip-v" type="checkbox" /><span>Flip vertical</span></label>
      <label class="toggle"><input id="image-grayscale" type="checkbox" /><span>Grayscale</span></label>
    </div>
  `;

  const qualityInput = document.getElementById("image-quality");
  const qualityValue = document.getElementById("image-quality-value");
  const brightnessInput = document.getElementById("image-brightness");
  const brightnessValue = document.getElementById("image-brightness-value");
  const widthInput = document.getElementById("image-width");
  const heightInput = document.getElementById("image-height");
  const keepAspect = document.getElementById("keep-aspect");

  let syncing = false;

  function updateQuality() {
    const lossless = formatSelect.value === "png";
    qualityInput.disabled = lossless;
    qualityValue.textContent = lossless ? "lossless" : qualityInput.value;
  }

  qualityInput.addEventListener("input", updateQuality);
  formatSelect.addEventListener("change", updateQuality);
  brightnessInput.addEventListener("input", () => {
    brightnessValue.textContent = `${brightnessInput.value}%`;
  });

  function syncDim(source) {
    if (!keepAspect.checked || !appState.sourceWidth || !appState.sourceHeight || syncing) {
      return;
    }

    syncing = true;
    if (source === "width") {
      const width = parseInt(widthInput.value, 10);
      if (width > 0) {
        heightInput.value = Math.max(
          1,
          Math.round(width / (appState.sourceWidth / appState.sourceHeight)),
        );
      }
    } else {
      const height = parseInt(heightInput.value, 10);
      if (height > 0) {
        widthInput.value = Math.max(
          1,
          Math.round(height * (appState.sourceWidth / appState.sourceHeight)),
        );
      }
    }
    syncing = false;
  }

  widthInput.addEventListener("input", () => syncDim("width"));
  heightInput.addEventListener("input", () => syncDim("height"));

  if (appState.sourceWidth) {
    widthInput.value = appState.sourceWidth;
    heightInput.value = appState.sourceHeight;
  }

  updateQuality();
}

async function handleFile(file) {
  const type = detectFileType(file);
  if (!type) {
    setStatus("Unsupported file. Drop an audio or image file.", "warning");
    return;
  }

  if (appState.sourceUrl) {
    URL.revokeObjectURL(appState.sourceUrl);
  }
  if (appState.outputUrl) {
    URL.revokeObjectURL(appState.outputUrl);
  }

  appState.file = file;
  appState.fileType = type;
  appState.sourceUrl = null;
  appState.outputUrl = null;
  appState.sourceWidth = null;
  appState.sourceHeight = null;

  filePill.textContent = `${file.name} · ${formatFileSize(file.size)}`;
  workspace.hidden = false;
  downloadLink.hidden = true;
  outputPreview.innerHTML = `<p class="preview-empty">Converted preview appears here.</p>`;

  populateFormats(type);

  if (type === "audio") {
    buildAudioSettings();
  } else {
    buildImageSettings();
  }

  appState.sourceUrl = URL.createObjectURL(file);
  sourcePreview.innerHTML = "";

  if (type === "audio") {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = appState.sourceUrl;
    sourcePreview.appendChild(audio);
  } else {
    const img = document.createElement("img");
    img.alt = "Source preview";
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = appState.sourceUrl;
    });
    appState.sourceWidth = img.naturalWidth || null;
    appState.sourceHeight = img.naturalHeight || null;
    sourcePreview.appendChild(img);

    const widthInput = document.getElementById("image-width");
    const heightInput = document.getElementById("image-height");
    if (widthInput && appState.sourceWidth) {
      widthInput.value = appState.sourceWidth;
      heightInput.value = appState.sourceHeight;
    }
  }

  setStatus(`${type === "audio" ? "Audio" : "Image"} ready — pick a format and convert.`);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) {
    handleFile(file);
  }
});

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-dragging");
});

dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragging"));

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-dragging");
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    handleFile(file);
  }
});

async function ensureFfmpeg() {
  if (ffmpegState.loaded) {
    return ffmpegState.instance;
  }

  if (!ffmpegState.loadingPromise) {
    ffmpegState.loadingPromise = (async () => {
      setStatus("Loading conversion engine…", "info");
      const ffmpeg = new FFmpeg();
      ffmpeg.on("progress", ({ progress }) => {
        setStatus(`Converting… ${Math.max(1, Math.round(progress * 100))}%`, "info");
      });
      await ffmpeg.load({ coreURL: FFMPEG_CORE_URL, wasmURL: FFMPEG_WASM_URL });
      ffmpegState.instance = ffmpeg;
      ffmpegState.loaded = true;
      return ffmpeg;
    })().finally(() => {
      ffmpegState.loadingPromise = null;
    });
  }

  return ffmpegState.loadingPromise;
}

function buildAudioOutputConfig(format) {
  const bitrate = document.getElementById("audio-bitrate")?.value ?? "192k";
  switch (format) {
    case "wav":
      return { extension: "wav", mime: "audio/wav", args: ["-vn", "-c:a", "pcm_s16le"] };
    case "ogg":
      return { extension: "ogg", mime: "audio/ogg", args: ["-vn", "-c:a", "libvorbis", "-q:a", "5"] };
    case "aac":
      return { extension: "m4a", mime: "audio/mp4", args: ["-vn", "-c:a", "aac", "-b:a", bitrate] };
    case "flac":
      return { extension: "flac", mime: "audio/flac", args: ["-vn", "-c:a", "flac"] };
    default:
      return {
        extension: "mp3",
        mime: "audio/mpeg",
        args: ["-vn", "-c:a", "libmp3lame", "-b:a", bitrate],
      };
  }
}

function buildImageOutputConfig(format) {
  const quality = parseInt(document.getElementById("image-quality")?.value ?? "88", 10);
  if (format === "jpg") {
    return {
      extension: "jpg",
      mime: "image/jpeg",
      args: ["-q:v", String(Math.max(2, Math.min(31, Math.round(31 - (quality / 100) * 29))))],
    };
  }
  if (format === "webp") {
    return {
      extension: "webp",
      mime: "image/webp",
      args: ["-q:v", String(quality), "-compression_level", "6"],
    };
  }
  return { extension: "png", mime: "image/png", args: ["-compression_level", "6"] };
}

function buildImageFilterGraph() {
  const filters = [];
  const width = parseInt(document.getElementById("image-width")?.value, 10);
  const height = parseInt(document.getElementById("image-height")?.value, 10);
  const rotation = document.getElementById("image-rotation")?.value ?? "0";
  const brightness = Number(document.getElementById("image-brightness")?.value ?? 100);
  const flipH = document.getElementById("image-flip-h")?.checked;
  const flipV = document.getElementById("image-flip-v")?.checked;
  const grayscale = document.getElementById("image-grayscale")?.checked;

  if ((Number.isFinite(width) && width > 0) || (Number.isFinite(height) && height > 0)) {
    filters.push(
      `scale=${Number.isFinite(width) && width > 0 ? width : -1}:${
        Number.isFinite(height) && height > 0 ? height : -1
      }:flags=lanczos`,
    );
  }
  if (rotation === "90") {
    filters.push("transpose=1");
  } else if (rotation === "180") {
    filters.push("hflip", "vflip");
  } else if (rotation === "270") {
    filters.push("transpose=2");
  }
  if (flipH) {
    filters.push("hflip");
  }
  if (flipV) {
    filters.push("vflip");
  }
  if (grayscale) {
    filters.push("hue=s=0");
  }
  if (brightness !== 100) {
    filters.push(`eq=brightness=${((brightness - 100) / 100).toFixed(2)}`);
  }
  return filters.join(",");
}

async function convert() {
  if (!appState.file) {
    return;
  }
  if (ffmpegState.busy) {
    setStatus("A conversion is already running.", "warning");
    return;
  }

  convertBtn.disabled = true;
  downloadLink.hidden = true;
  outputPreview.innerHTML = `<p class="preview-empty">Converting…</p>`;

  try {
    const ffmpeg = await ensureFfmpeg();
    ffmpegState.busy = true;

    const format = formatSelect.value;
    const srcExt = appState.file.name.includes(".") ? `.${appState.file.name.split(".").pop()}` : ".bin";
    const inputName = `input-${Date.now()}${srcExt}`;

    let config;
    let outputName;
    let outputBlob;

    if (appState.fileType === "audio") {
      config = buildAudioOutputConfig(format);
      outputName = `${safeBaseName(appState.file.name) || "converted"}.${config.extension}`;
      await ffmpeg.writeFile(inputName, new Uint8Array(await appState.file.arrayBuffer()));
      const sampleRate = document.getElementById("audio-sample-rate")?.value ?? "keep";
      const args = ["-i", inputName];
      if (sampleRate !== "keep") {
        args.push("-ar", sampleRate);
      }
      args.push(...config.args, outputName);
      await ffmpeg.exec(args);
      const data = await ffmpeg.readFile(outputName);
      outputBlob = new Blob([data.buffer], { type: config.mime });
    } else {
      config = buildImageOutputConfig(format);
      outputName = `${safeBaseName(appState.file.name) || "converted"}.${config.extension}`;
      const filterGraph = buildImageFilterGraph();
      await ffmpeg.writeFile(inputName, new Uint8Array(await appState.file.arrayBuffer()));
      const args = ["-i", inputName];
      if (filterGraph) {
        args.push("-vf", filterGraph);
      }
      args.push("-frames:v", "1", ...config.args, outputName);
      await ffmpeg.exec(args);
      const data = await ffmpeg.readFile(outputName);
      outputBlob = new Blob([data.buffer], { type: config.mime });
    }

    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);

    if (appState.outputUrl) {
      URL.revokeObjectURL(appState.outputUrl);
    }
    appState.outputUrl = URL.createObjectURL(outputBlob);
    outputPreview.innerHTML = "";

    if (appState.fileType === "audio") {
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = appState.outputUrl;
      outputPreview.appendChild(audio);
    } else {
      const img = document.createElement("img");
      img.alt = "Converted preview";
      img.src = appState.outputUrl;
      outputPreview.appendChild(img);
    }

    downloadLink.href = appState.outputUrl;
    downloadLink.download = outputName;
    downloadLink.hidden = false;

    setStatus(`Converted to ${config.extension.toUpperCase()}.`, "success");
  } catch (err) {
    setStatus(err.message || "Conversion failed.", "danger");
    outputPreview.innerHTML = `<p class="preview-empty">Conversion failed.</p>`;
  } finally {
    ffmpegState.busy = false;
    convertBtn.disabled = false;
  }
}

convertBtn.addEventListener("click", convert);
