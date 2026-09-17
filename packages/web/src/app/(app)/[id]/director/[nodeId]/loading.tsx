import { Loader2 } from "lucide-react";

export default function DirectorStageLoading() {
  return (
    <div className="canvas-fullscreen flex items-center justify-center bg-black text-sm text-white/40">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      加载导演台…
    </div>
  );
}
