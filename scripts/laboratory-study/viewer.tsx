import { useEffect, useRef, useState } from "react";
import { study } from "./runtime";

/** Study-only substitute for the opaque native PDF iframe. Same viewer in A/B.
 * Images are rasterized locally from the hash-pinned original, never model output. */
export function PrivateDocumentPreview({ document }: { document: { title: string } }) {
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const surface = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(440);
  const [aspect, setAspect] = useState(1.414);
  useEffect(() => {
    const observer = new ResizeObserver(() => setWidth(surface.current?.clientWidth ?? 440));
    if (surface.current) observer.observe(surface.current);
    return () => observer.disconnect();
  }, []);
  const rawWidth = width * zoom,
    rawHeight = rawWidth * aspect;
  const transform =
    rotation === 90
      ? "rotate(90deg) translateY(-100%)"
      : rotation === 180
        ? "rotate(180deg) translate(-100%,-100%)"
        : rotation === 270
          ? "rotate(270deg) translateX(-100%)"
          : "none";
  const pages = study.current?.pages ?? [];
  return (
    <div>
      <p className="text-xs text-muted-foreground">
        Original sintético · visualizador instrumentado do estudo
      </p>
      <div className="flex flex-wrap gap-2 py-2">
        <button
          disabled={page === 0}
          onClick={() => {
            setPage(page - 1);
            study.viewedPage = page;
            study.log("original_page_change", { page });
          }}
        >
          Anterior
        </button>
        <span>
          Página {page + 1}/{pages.length}
        </span>
        <button
          disabled={page + 1 === pages.length}
          onClick={() => {
            setPage(page + 1);
            study.viewedPage = page + 2;
            study.log("original_page_change", { page: page + 2 });
          }}
        >
          Próxima
        </button>
        <button
          aria-label="Diminuir zoom do original"
          onClick={() => {
            setZoom(Math.max(0.5, zoom - 0.25));
            study.log("zoom", { control: "out", page: page + 1 });
          }}
        >
          −
        </button>
        <button
          aria-label="Aumentar zoom do original"
          onClick={() => {
            setZoom(Math.min(3, zoom + 0.25));
            study.log("zoom", { control: "in", page: page + 1 });
          }}
        >
          +
        </button>
        <button
          onClick={() => {
            setRotation((rotation + 90) % 360);
            study.log("rotate", { page: page + 1 });
          }}
        >
          Girar
        </button>
      </div>
      <div
        ref={surface}
        className="max-h-[62dvh] overflow-auto border"
        onClick={() => study.log("original_open", { page: page + 1 })}
      >
        <div
          style={{
            position: "relative",
            width: rotation % 180 ? rawHeight : rawWidth,
            height: rotation % 180 ? rawWidth : rawHeight,
          }}
        >
          <img
            src={pages[page]}
            alt={document.title + ", página " + (page + 1)}
            style={{
              maxWidth: "none",
              width: rawWidth,
              position: "absolute",
              top: 0,
              left: 0,
              transform,
              transformOrigin: "top left",
            }}
            onLoad={(event) => {
              setAspect(event.currentTarget.naturalHeight / event.currentTarget.naturalWidth);
              study.imageReady = true;
              window.dispatchEvent(new Event("study-image-ready"));
            }}
          />
        </div>
      </div>
    </div>
  );
}
