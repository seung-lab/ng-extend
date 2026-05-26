// Open the OS file picker and resolve with the chosen File (or null if
// cancelled).  Uses a transient detached <input> so callers don't need
// to own a hidden DOM input — handy since the import controls live in
// two unrelated places (the top bar and the welcome overlay).
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", () => {
      resolve(input.files && input.files[0] ? input.files[0] : null);
      input.remove();
    });
    // If the dialog is cancelled there's no reliable cross-browser
    // event, so we just leave the transient input to be GC'd.
    document.body.appendChild(input);
    input.click();
  });
}

// Read a File as text, transparently gunzip-ing if the filename ends
// with .gz / .json.gz.  Hugging Face serves small files with
// Content-Disposition: inline so plain .json links render in the
// browser instead of downloading; the workaround is to publish
// .json.gz instead (always downloads) and decompress in-browser via
// the standard DecompressionStream API.
export async function readBundleFile(f: File): Promise<string> {
  const isGz =
    /\.gz(?:ip)?$/i.test(f.name) ||
    f.type === "application/gzip" ||
    f.type === "application/x-gzip";
  if (!isGz) return f.text();
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "This browser cannot decompress .gz files (needs " +
        "DecompressionStream).  Please use Chrome/Edge/Firefox 113+/" +
        "Safari 16.4+.",
    );
  }
  const stream = f.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
