/** Instant paint shell — improves LCP before client bundle hydrates. */
export default function CanvasRouteLoading() {
  return (
    <div className="canvas-fullscreen bg-black" aria-busy="true" aria-label="画布加载中">
      <div className="absolute left-0 right-0 top-0 z-30 flex h-14 items-center border-b border-white/5 px-4">
        <span className="text-lg font-bold">
          <span className="text-primary">聚梦</span>
          <span className="text-foreground/90">画布</span>
        </span>
      </div>
      <div className="absolute inset-0 top-14 bg-black" />
    </div>
  );
}
